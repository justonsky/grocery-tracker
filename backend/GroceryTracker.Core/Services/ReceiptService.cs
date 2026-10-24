using GroceryTracker.Core.Data;
using GroceryTracker.Core.Dtos;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

public enum ReceiptResult { Ok, NotFound, NotConfigured, Disabled, Unreadable, AlreadyApplied, Invalid, Conflict }

// Receipt import: read a photo (or pasted text) into a draft, suggest an item for each line, and —
// once the user has reviewed it in the trip editor — learn the store's names for those items. The
// trip itself is changed by the editor (a trip save replaces the whole trip, so writing it here
// would race an open editor). The photo is deleted when the receipt is applied or discarded.
public class ReceiptService(
    GroceryTrackerDbContext db, IReceiptReader reader, ReceiptImageStore images, SettingsService settings,
    LookupService lookup, IClock clock)
{
    public const int MaxImageBytes = 10 * 1024 * 1024;
    private const int ShownCandidates = 5;
    private const int ChooseFrom = 20;
    private const double CandidateFloor = 0.35;
    private const double ChooseFloor = 0.2;
    private static readonly TimeSpan DraftLifetime = TimeSpan.FromDays(7);
    private static readonly string[] Kinds = ["item", "tax", "fee", "tip", "deposit"];

    public async Task<ReceiptStatusDto> StatusAsync(CancellationToken ct) =>
        new(reader.Configured, (await settings.GetAsync(ct)).ReceiptImport);

    public async Task<(ReceiptResult Result, ReceiptDraftDto? Draft, string? Error)> CreateAsync(
        byte[]? image, string? contentType, string? text, string? fixture, CancellationToken ct)
    {
        if (!reader.Configured) return (ReceiptResult.NotConfigured, null, null);
        if (!(await settings.GetAsync(ct)).ReceiptImport) return (ReceiptResult.Disabled, null, null);
        await RemoveStaleDraftsAsync(ct);

        var categories = await db.Categories.OrderBy(c => c.SortOrder).Select(c => c.Name).ToListAsync(ct);
        ReceiptReading reading;
        try
        {
            reading = image is not null
                ? await reader.ReadImageAsync(image, contentType!, categories, fixture, ct)
                : await reader.ReadTextAsync(text!, categories, fixture, ct);
        }
        catch (ReceiptReadException e)
        {
            return (ReceiptResult.Unreadable, null, e.Message);
        }

        var receipt = new Receipt
        {
            Id = Guid.NewGuid(),
            Status = ReceiptStatus.Draft,
            StoreRead = Trim(reading.Store, 120),
            Date = IsIsoDate(reading.Date) ? reading.Date : null,
            SubtotalCents = Cents(reading.Subtotal),
            TotalCents = Cents(reading.Total),
            CreatedAt = clock.UtcNow,
            HasImage = image is not null,
        };
        var order = 0;
        foreach (var line in reading.Lines.Where(l => !string.IsNullOrWhiteSpace(l.Text)))
        {
            var quantity = line.Quantity is { } q && Quantities.IsValidQuantity(q) ? q : 1m;
            receipt.Lines.Add(new ReceiptLine
            {
                Id = Guid.NewGuid(), ReceiptId = receipt.Id, SortOrder = order++,
                Text = Trim(line.Text, 200)!, Code = Trim(line.Code, 40), Name = Trim(line.Name, 120),
                QuantityMilli = Quantities.ToMilli(quantity),
                Unit = Quantities.IsValidUnit(line.Unit) && line.Unit is not null ? line.Unit : Quantities.Each,
                UnitPriceCents = Cents(line.UnitPrice),
                PriceCents = Cents(line.Amount) ?? 0,
                DiscountCents = Cents(line.Discount) is { } d and > 0 ? d : 0,
                Kind = line.Kind is { } k && Kinds.Contains(k) ? k : "item",
                Category = categories.FirstOrDefault(c => string.Equals(c, line.Category?.Trim(), StringComparison.OrdinalIgnoreCase)),
            });
        }
        // The printed tax figure, or the tax lines when it isn't printed.
        receipt.TaxCents = Cents(reading.Tax) ?? receipt.Lines.Where(l => l.Kind == "tax").Sum(l => l.PriceCents);
        receipt.StoreName = await GuessStoreAsync(receipt.StoreRead, ct);

        // The photo first, so a draft never says it has an image that was never written.
        if (image is not null) await images.SaveAsync(receipt.Id, image, ct);
        db.Receipts.Add(receipt);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            images.Delete(receipt.Id);
            throw;
        }
        return (ReceiptResult.Ok, await DraftAsync(receipt, receipt.StoreName, ct), null);
    }

    // The draft with suggestions for a store (the receipt's own unless another is given).
    public async Task<ReceiptDraftDto?> GetAsync(Guid id, string? storeName, CancellationToken ct)
    {
        var receipt = await db.Receipts.Include(r => r.Lines).FirstOrDefaultAsync(r => r.Id == id, ct);
        return receipt is null ? null : await DraftAsync(receipt, string.IsNullOrWhiteSpace(storeName) ? receipt.StoreName : storeName.Trim(), ct);
    }

    public async Task<(ReceiptResult Result, ApplyReceiptResultDto? Applied)> ApplyAsync(Guid id, ApplyReceiptRequest request, CancellationToken ct)
    {
        var receipt = await db.Receipts.Include(r => r.Lines).FirstOrDefaultAsync(r => r.Id == id, ct);
        if (receipt is null) return (ReceiptResult.NotFound, null);
        if (receipt.Status == ReceiptStatus.Applied) return (ReceiptResult.AlreadyApplied, null);
        if (!Amounts.IsValidName(request.StoreName) || request.Lines is null || request.Lines.Any(l => !Amounts.IsValidName(l.ItemName)))
            return (ReceiptResult.Invalid, null);
        var categoryIds = request.Lines.Where(l => l.CategoryId is not null).Select(l => l.CategoryId!.Value).Distinct().ToList();
        if (await db.Categories.CountAsync(c => categoryIds.Contains(c.Id), ct) != categoryIds.Count)
            return (ReceiptResult.Invalid, null);
        var lines = receipt.Lines.ToDictionary(l => l.Id);
        if (request.Lines.Any(l => !lines.TryGetValue(l.LineId, out var line) || line.Kind != "item"))
            return (ReceiptResult.Invalid, null);

        var store = await lookup.ResolveStoreAsync(request.StoreName, ct);
        var now = clock.UtcNow;
        var learned = 0;
        var applied = new List<AppliedReceiptLineDto>();
        var aliases = await db.ItemAliases.Where(a => a.StoreId == store.Id).ToDictionaryAsync(a => a.Key, ct);
        foreach (var pick in request.Lines)
        {
            var line = lines[pick.LineId];
            var item = await lookup.ResolveItemAsync(pick.ItemName, pick.CategoryId, ct);
            applied.Add(new AppliedReceiptLineDto(line.Id, item.Id, item.Name));
            var key = ReceiptKeys.KeyFor(line.Text, line.Code);
            if (aliases.TryGetValue(key, out var alias))
            {
                if (alias.ItemId != item.Id) learned++;
                alias.ItemId = item.Id;
                alias.TimesUsed++;
                alias.LastUsedAt = now;
                alias.Label = line.Text;
            }
            else
            {
                alias = new ItemAlias { Id = Guid.NewGuid(), StoreId = store.Id, Key = key, Label = line.Text, ItemId = item.Id, TimesUsed = 1, LastUsedAt = now };
                db.ItemAliases.Add(alias);
                aliases[key] = alias;
                learned++;
            }
        }

        receipt.Status = ReceiptStatus.Applied;
        receipt.AppliedAt = now;
        receipt.StoreName = store.Name;
        receipt.HasImage = false;
        await db.SaveChangesAsync(ct);
        images.Delete(receipt.Id);
        return (ReceiptResult.Ok, new ApplyReceiptResultDto(learned, applied));
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct)
    {
        var receipt = await db.Receipts.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (receipt is null) return false;
        db.Receipts.Remove(receipt);
        await db.SaveChangesAsync(ct);
        images.Delete(id);
        return true;
    }

    public async Task<List<ItemAliasDto>?> AliasesForItemAsync(Guid itemId, CancellationToken ct)
    {
        if (!await db.Items.AnyAsync(i => i.Id == itemId, ct)) return null;
        return (await db.ItemAliases.Where(a => a.ItemId == itemId)
                .Select(a => new { a.Id, Store = a.Store!.Name, a.Label, a.Key, a.ItemId, ItemName = a.Item!.Name, a.TimesUsed, a.LastUsedAt }).ToListAsync(ct))
            .OrderByDescending(a => a.LastUsedAt)
            .Select(a => new ItemAliasDto(a.Id, a.Store, a.Label, ReceiptKeys.CodeOf(a.Key), a.ItemId, a.ItemName, a.TimesUsed, a.LastUsedAt.ToString("yyyy-MM-dd")))
            .ToList();
    }

    // Adds a receipt name by hand (aliasId null) or corrects one: its store, printed text, item code,
    // or the item it means. Two names can't share a store and key (a code, or else the text).
    public async Task<(ReceiptResult Result, ItemAliasDto? Alias)> SaveAliasAsync(Guid? aliasId, Guid? itemId, SaveItemAliasRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.StoreName) || string.IsNullOrWhiteSpace(request.Label) || request.Label.Trim().Length > 200
            || (request.Code?.Trim().Length ?? 0) > 40)
            return (ReceiptResult.Invalid, null);
        var key = ReceiptKeys.KeyFor(request.Label, request.Code);
        if (key == "text:") return (ReceiptResult.Invalid, null); // nothing but punctuation

        ItemAlias? alias = null;
        if (aliasId is { } id)
        {
            alias = await db.ItemAliases.FirstOrDefaultAsync(a => a.Id == id, ct);
            if (alias is null) return (ReceiptResult.NotFound, null);
        }
        var targetItem = request.ItemId ?? itemId ?? alias?.ItemId;
        if (targetItem is null || !await db.Items.AnyAsync(i => i.Id == targetItem, ct)) return (ReceiptResult.NotFound, null);

        var store = await lookup.ResolveStoreAsync(request.StoreName, ct);
        if (await db.ItemAliases.AnyAsync(a => a.StoreId == store.Id && a.Key == key && a.Id != aliasId, ct))
            return (ReceiptResult.Conflict, null);

        if (alias is null)
        {
            alias = new ItemAlias { Id = Guid.NewGuid(), Key = key, Label = request.Label.Trim(), StoreId = store.Id, ItemId = targetItem.Value, TimesUsed = 0, LastUsedAt = clock.UtcNow };
            db.ItemAliases.Add(alias);
        }
        alias.StoreId = store.Id;
        alias.Key = key;
        alias.Label = request.Label.Trim();
        alias.ItemId = targetItem.Value;
        await db.SaveChangesAsync(ct);

        var saved = await db.ItemAliases.Where(a => a.Id == alias.Id)
            .Select(a => new { a.Id, Store = a.Store!.Name, a.Label, a.Key, a.ItemId, ItemName = a.Item!.Name, a.TimesUsed, a.LastUsedAt }).FirstAsync(ct);
        return (ReceiptResult.Ok, new ItemAliasDto(saved.Id, saved.Store, saved.Label, ReceiptKeys.CodeOf(saved.Key), saved.ItemId, saved.ItemName, saved.TimesUsed, saved.LastUsedAt.ToString("yyyy-MM-dd")));
    }

    public async Task<bool> DeleteAliasAsync(Guid aliasId, CancellationToken ct)
    {
        var alias = await db.ItemAliases.FindAsync([aliasId], ct);
        if (alias is null) return false;
        db.ItemAliases.Remove(alias);
        await db.SaveChangesAsync(ct);
        return true;
    }

    private async Task<ReceiptDraftDto> DraftAsync(Receipt receipt, string? storeName, CancellationToken ct)
    {
        var lines = receipt.Lines.OrderBy(l => l.SortOrder).ToList();
        var catalogue = await db.Items.Select(i => new { i.Id, i.Name, i.DefaultCategoryId }).ToListAsync(ct);
        var categoryIds = (await db.Categories.Select(c => new { c.Name, c.Id }).ToListAsync(ct))
            .ToDictionary(c => c.Name, c => c.Id, StringComparer.OrdinalIgnoreCase);
        var byId = catalogue.ToDictionary(i => i.Id);
        var storeKey = storeName is null ? null : ReceiptKeys.StoreKey(storeName);
        var storeIds = storeKey is null ? [] : (await db.Stores.Select(s => new { s.Id, s.Name }).ToListAsync(ct))
            .Where(s => ReceiptKeys.StoreKey(s.Name) == storeKey).Select(s => s.Id).ToList();
        var aliases = storeIds.Count == 0 ? new Dictionary<string, Guid>() : (await db.ItemAliases
                .Where(a => storeIds.Contains(a.StoreId)).Select(a => new { a.Key, a.ItemId }).ToListAsync(ct))
            .GroupBy(a => a.Key).ToDictionary(g => g.Key, g => g.First().ItemId);

        var matches = new Dictionary<Guid, ReceiptMatchDto>();
        var shown = new Dictionary<Guid, List<ReceiptCandidateDto>>();
        var toChoose = new List<(ReceiptLine Line, List<ReceiptCandidateDto> Pool)>();
        foreach (var line in lines.Where(l => l.Kind == "item"))
        {
            if (aliases.TryGetValue(ReceiptKeys.KeyFor(line.Text, line.Code), out var aliased) && byId.TryGetValue(aliased, out var known))
            {
                matches[line.Id] = new ReceiptMatchDto(known.Id, known.Name, known.DefaultCategoryId, "alias");
                shown[line.Id] = [];
                continue;
            }
            var pool = catalogue
                .Select(i => new ReceiptCandidateDto(i.Id, i.Name, i.DefaultCategoryId,
                    Math.Round(Math.Max(ItemNameMatcher.Score(line.Text, i.Name), line.Name is null ? 0 : ItemNameMatcher.Score(line.Name, i.Name)), 3)))
                .Where(c => c.Score >= ChooseFloor)
                .OrderByDescending(c => c.Score).ThenBy(c => c.ItemName, StringComparer.OrdinalIgnoreCase)
                .Take(ChooseFrom).ToList();
            shown[line.Id] = pool.Where(c => c.Score >= CandidateFloor).Take(ShownCandidates).ToList();
            if (pool.Count > 0) toChoose.Add((line, pool));
        }

        if (toChoose.Count > 0)
        {
            try
            {
                var choices = await reader.ChooseAsync(toChoose.Select(t => (t.Line.Text, t.Line.Name, t.Pool.Select(c => c.ItemName).ToList())).ToList(), ct);
                for (var i = 0; i < toChoose.Count && i < choices.Count; i++)
                {
                    if (choices[i] is not { } pick) continue;
                    var chosen = toChoose[i].Pool[pick];
                    matches[toChoose[i].Line.Id] = new ReceiptMatchDto(chosen.ItemId, chosen.ItemName, chosen.CategoryId, "suggested");
                    if (!shown[toChoose[i].Line.Id].Any(c => c.ItemId == chosen.ItemId)) shown[toChoose[i].Line.Id].Insert(0, chosen);
                }
            }
            catch (ReceiptReadException)
            {
                // No suggestions this time; the lines can still be matched by hand.
            }
        }

        var linesTotal = lines.Sum(l => l.PriceCents);
        var difference = receipt.TotalCents is { } total ? total - linesTotal : 0;
        return new ReceiptDraftDto(
            receipt.Id, receipt.Status.ToString().ToLowerInvariant(), receipt.StoreRead, storeName, receipt.Date,
            receipt.SubtotalCents / 100m, receipt.TaxCents / 100m, receipt.TotalCents / 100m,
            linesTotal / 100m, difference / 100m, receipt.TotalCents is null || Math.Abs(difference) <= 1,
            lines.Select(l => new ReceiptLineDto(
                l.Id, l.Text, l.Code, l.Name, Quantities.FromMilli(l.QuantityMilli), l.Unit,
                l.UnitPriceCents / 100m, l.PriceCents / 100m, l.DiscountCents / 100m, l.Kind,
                matches.GetValueOrDefault(l.Id), shown.GetValueOrDefault(l.Id) ?? [],
                l.Category is { } c && categoryIds.TryGetValue(c, out var cid) ? cid : null)).ToList());
    }

    // The household store this is ("ALDI" → Aldi, "BJ's Wholesale Club" → BJ's), else as printed.
    private async Task<string?> GuessStoreAsync(string? printed, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(printed)) return null;
        var key = ReceiptKeys.StoreKey(printed);
        var stores = await db.Stores.Select(s => s.Name).ToListAsync(ct);
        return stores.FirstOrDefault(s => ReceiptKeys.StoreKey(s) == key)
            ?? stores.Where(s => ReceiptKeys.StoreKey(s).Length >= 3)
                .FirstOrDefault(s => key.Contains(ReceiptKeys.StoreKey(s), StringComparison.Ordinal) || ReceiptKeys.StoreKey(s).Contains(key, StringComparison.Ordinal))
            ?? printed.Trim();
    }

    // Drafts nobody applied or discarded (a closed tab) don't keep their photos for long.
    private async Task RemoveStaleDraftsAsync(CancellationToken ct)
    {
        var cutoff = clock.UtcNow - DraftLifetime;
        var stale = (await db.Receipts.Where(r => r.Status == ReceiptStatus.Draft).ToListAsync(ct)).Where(r => r.CreatedAt < cutoff).ToList();
        if (stale.Count == 0) return;
        db.Receipts.RemoveRange(stale);
        await db.SaveChangesAsync(ct);
        foreach (var r in stale) images.Delete(r.Id);
    }

    // A reading can say anything; clamp it into what the cents columns hold (discounts may be negative).
    private static int? Cents(decimal? amount) =>
        amount is null ? null : (int)Math.Round(Math.Clamp(amount.Value, -Amounts.MaxAmount, Amounts.MaxAmount) * 100m, MidpointRounding.AwayFromZero);
    private static string? Trim(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : (s.Trim().Length > max ? s.Trim()[..max] : s.Trim());
    private static bool IsIsoDate(string? s) => s is not null && DateOnly.TryParseExact(s, "yyyy-MM-dd", out _);
}

// Receipt photos, only while a receipt is a draft: <DataDirectory>/receipts/<id>.
public class ReceiptImageStore(string dataDirectory)
{
    private string Dir => Path.Combine(dataDirectory, "receipts");
    private string PathFor(Guid id) => Path.Combine(Dir, id.ToString("N"));

    public async Task SaveAsync(Guid id, byte[] bytes, CancellationToken ct)
    {
        Directory.CreateDirectory(Dir);
        await File.WriteAllBytesAsync(PathFor(id), bytes, ct);
    }

    public bool Exists(Guid id) => File.Exists(PathFor(id));

    public void Delete(Guid id)
    {
        if (File.Exists(PathFor(id))) File.Delete(PathFor(id));
    }
}
