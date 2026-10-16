using ClosedXML.Excel;
using GroceryTracker.Core.Data;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

// Generates the full on-device data backup server-side, from the same rows the
// app persists — guarantees the export is byte-for-byte consistent with what's
// actually stored, and keeps an XLSX-writing library out of the browser bundle.
//
// Sheets: Profiles; Trips (one row per trip, with the same totals the app shows);
// Trip Items (one row per line — a trip is both the plan and the log, so planned
// and bought lines share it); and, when asked for, Items (the household catalogue
// with its price statistics).
public class ExportService(GroceryTrackerDbContext db, IClock clock)
{
    private const string Money = "$#,##0.00";

    public async Task<byte[]> BuildBackupAsync(bool includeItems = false, CancellationToken ct = default)
    {
        var profiles = await db.Profiles
            .Select(p => new { p.Name, p.Theme, p.CreatedAt, TripCount = p.Trips.Count })
            .ToListAsync(ct);

        var trips = await db.Trips
            .Select(t => new
            {
                t.Id,
                Profile = t.Profile!.Name,
                t.Name,
                t.Date,
                t.Status,
                t.BudgetCents,
                t.CompletedAt,
                t.CreatedAt,
                Stores = t.Stores.OrderBy(s => s.SortOrder).Select(s => s.Name).ToList(),
            })
            .ToListAsync(ct);
        trips = trips.OrderBy(t => t.Date, StringComparer.Ordinal).ThenBy(t => t.CreatedAt).ToList();

        var lines = await db.TripItems
            .Select(ti => new
            {
                ti.TripId,
                ti.ItemId,
                ti.SortOrder,
                Item = ti.Item!.Name,
                Category = ti.Category!.Name,
                Store = ti.Store != null ? ti.Store.Name : null,
                ti.Checked,
                ti.EstimateCents,
                ti.PriceCents,
                ti.PricedAt,
            })
            .ToListAsync(ct);
        var linesByTrip = lines.GroupBy(l => l.TripId).ToDictionary(g => g.Key, g => g.OrderBy(l => l.SortOrder).ToList());
        var now = clock.UtcNow;

        using var workbook = new XLWorkbook();

        var profilesSheet = workbook.Worksheets.Add("Profiles");
        WriteHeader(profilesSheet, "Name", "Theme", "Trips", "Created");
        var row = 2;
        foreach (var p in profiles.OrderBy(p => p.CreatedAt))
        {
            profilesSheet.Cell(row, 1).Value = p.Name;
            profilesSheet.Cell(row, 2).Value = p.Theme;
            profilesSheet.Cell(row, 3).Value = p.TripCount;
            profilesSheet.Cell(row, 4).Value = p.CreatedAt.ToString("yyyy-MM-dd");
            row++;
        }

        // Totals follow TripService: spend sums priced lines, the estimate sums
        // estimated lines, and savings compares the two only where a line has both.
        var tripsSheet = workbook.Worksheets.Add("Trips");
        WriteHeader(tripsSheet, "Profile", "Date", "Trip", "Status", "Stores", "Items", "Picked Up",
            "Budget", "Estimated", "Spent", "Savings", "Budget Left", "Completed");
        row = 2;
        foreach (var t in trips)
        {
            var tripLines = linesByTrip.GetValueOrDefault(t.Id) ?? [];
            var spent = tripLines.Sum(l => l.PriceCents ?? 0);
            var estimated = tripLines.Sum(l => l.EstimateCents ?? 0);
            var compared = tripLines.Where(l => l.EstimateCents is not null && l.PriceCents is not null).ToList();

            tripsSheet.Cell(row, 1).Value = t.Profile;
            tripsSheet.Cell(row, 2).Value = t.Date;
            tripsSheet.Cell(row, 3).Value = t.Name ?? "";
            tripsSheet.Cell(row, 4).Value = t.Status.ToString();
            tripsSheet.Cell(row, 5).Value = string.Join(", ", t.Stores);
            tripsSheet.Cell(row, 6).Value = tripLines.Count;
            tripsSheet.Cell(row, 7).Value = tripLines.Count(l => l.Checked);
            if (t.BudgetCents is { } budget) tripsSheet.Cell(row, 8).Value = budget / 100m;
            if (tripLines.Any(l => l.EstimateCents is not null)) tripsSheet.Cell(row, 9).Value = estimated / 100m;
            tripsSheet.Cell(row, 10).Value = spent / 100m;
            if (compared.Count > 0) tripsSheet.Cell(row, 11).Value = compared.Sum(l => l.EstimateCents!.Value - l.PriceCents!.Value) / 100m;
            if (t.BudgetCents is { } b) tripsSheet.Cell(row, 12).Value = (b - spent) / 100m;
            if (t.CompletedAt is { } completed) tripsSheet.Cell(row, 13).Value = completed.ToString("yyyy-MM-dd");
            row++;
        }
        FormatMoney(tripsSheet, row, 8, 9, 10, 11, 12);

        var tripById = trips.ToDictionary(t => t.Id);
        var itemsSheet = workbook.Worksheets.Add("Trip Items");
        WriteHeader(itemsSheet, "Profile", "Date", "Trip", "Trip Stores", "Budget",
            "Status", "Item", "Category", "Store", "Picked Up", "Estimate", "Price", "Priced", "Price Locked");
        row = 2;
        foreach (var t in trips)
        {
            foreach (var l in linesByTrip.GetValueOrDefault(t.Id) ?? [])
            {
                itemsSheet.Cell(row, 1).Value = t.Profile;
                itemsSheet.Cell(row, 2).Value = t.Date;
                itemsSheet.Cell(row, 3).Value = t.Name ?? "";
                itemsSheet.Cell(row, 4).Value = string.Join(", ", t.Stores);
                if (t.BudgetCents is { } budget) itemsSheet.Cell(row, 5).Value = budget / 100m;
                itemsSheet.Cell(row, 6).Value = t.Status.ToString();
                itemsSheet.Cell(row, 7).Value = l.Item;
                itemsSheet.Cell(row, 8).Value = l.Category;
                itemsSheet.Cell(row, 9).Value = l.Store ?? "";
                itemsSheet.Cell(row, 10).Value = l.Checked;
                if (l.EstimateCents is { } estimate) itemsSheet.Cell(row, 11).Value = estimate / 100m;
                // Left blank rather than 0.00 for an item that has not been bought yet.
                if (l.PriceCents is { } price) itemsSheet.Cell(row, 12).Value = price / 100m;
                if (l.PricedAt is { } pricedAt) itemsSheet.Cell(row, 13).Value = pricedAt.ToString("yyyy-MM-dd");
                itemsSheet.Cell(row, 14).Value = l.PricedAt is { } at && now - at > TripService.PriceEditWindow;
                row++;
            }
        }
        FormatMoney(itemsSheet, row, 5, 11, 12);

        if (includeItems)
        {
            await WriteCatalogueAsync(workbook, lines.Select(l => (l.ItemId, l.PriceCents, tripById[l.TripId].Date)).ToList(), ct);
        }

        foreach (var sheet in workbook.Worksheets)
        {
            sheet.Row(1).Style.Font.Bold = true;
            sheet.SheetView.FreezeRows(1);
            sheet.Columns().AdjustToContents();
        }

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    // The household item catalogue, one row per item, with the price statistics
    // the app shows (household-wide, every profile's purchases).
    private async Task WriteCatalogueAsync(XLWorkbook workbook, List<(Guid ItemId, int? PriceCents, string Date)> lines, CancellationToken ct)
    {
        var items = await db.Items
            .Select(i => new { i.Id, i.Name, Category = i.DefaultCategory != null ? i.DefaultCategory.Name : "Other", i.CreatedAt })
            .ToListAsync(ct);
        var byItem = lines.GroupBy(l => l.ItemId).ToDictionary(g => g.Key, g => g.ToList());

        var sheet = workbook.Worksheets.Add("Items");
        WriteHeader(sheet, "Item", "Default Category", "Times Listed", "Purchases",
            "Average Price", "Last Price", "Lowest", "Highest", "First Bought", "Last Bought", "Added");
        var row = 2;
        foreach (var item in items.OrderBy(i => i.Name, StringComparer.OrdinalIgnoreCase))
        {
            var itemLines = byItem.GetValueOrDefault(item.Id) ?? [];
            var bought = itemLines.Where(l => l.PriceCents is > 0)
                .OrderBy(l => l.Date, StringComparer.Ordinal).ToList();

            sheet.Cell(row, 1).Value = item.Name;
            sheet.Cell(row, 2).Value = item.Category;
            sheet.Cell(row, 3).Value = itemLines.Count;
            sheet.Cell(row, 4).Value = bought.Count;
            if (bought.Count > 0)
            {
                sheet.Cell(row, 5).Value = Math.Round(bought.Average(l => (decimal)l.PriceCents!.Value) / 100m, 2, MidpointRounding.AwayFromZero);
                sheet.Cell(row, 6).Value = bought[^1].PriceCents!.Value / 100m;
                sheet.Cell(row, 7).Value = bought.Min(l => l.PriceCents!.Value) / 100m;
                sheet.Cell(row, 8).Value = bought.Max(l => l.PriceCents!.Value) / 100m;
                sheet.Cell(row, 9).Value = bought[0].Date;
                sheet.Cell(row, 10).Value = bought[^1].Date;
            }
            sheet.Cell(row, 11).Value = item.CreatedAt.ToString("yyyy-MM-dd");
            row++;
        }
        FormatMoney(sheet, row, 5, 6, 7, 8);
    }

    private static void FormatMoney(IXLWorksheet sheet, int endRow, params int[] columns)
    {
        if (endRow <= 2) return;
        foreach (var column in columns)
        {
            sheet.Range(2, column, endRow - 1, column).Style.NumberFormat.Format = Money;
        }
    }

    private static void WriteHeader(IXLWorksheet sheet, params string[] headers)
    {
        for (var i = 0; i < headers.Length; i++)
        {
            sheet.Cell(1, i + 1).Value = headers[i];
        }
    }
}
