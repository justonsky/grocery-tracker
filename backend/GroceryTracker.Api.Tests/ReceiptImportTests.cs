using System.Net;
using System.Net.Http.Headers;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Receipt import with the fixture reader: each fixture is one of the sample receipts (Aldi, BJ's)
// as the vision model is asked to return it.
public class ReceiptImportTests : IDisposable
{
    private static readonly DateTimeOffset FixedNow = new(2026, 8, 15, 12, 0, 0, TimeSpan.Zero);
    private readonly GroceryTrackerApiFactory _factory = new(FixedNow);
    private readonly HttpClient _client;

    public ReceiptImportTests() => _client = _factory.CreateClient();
    public void Dispose() => _factory.Dispose();

    private static byte[] Png(int padding = 0)
    {
        var b = new byte[33 + padding];
        new byte[] { 0x89, (byte)'P', (byte)'N', (byte)'G', 0x0D, 0x0A, 0x1A, 0x0A }.CopyTo(b, 0);
        b[19] = 100; b[23] = 100; // 100 × 100
        return b;
    }

    private string DataDir => _factory.DataDirectory;

    private async Task EnableAsync() => (await _client.PutJsonAsync("/api/v1/settings", new UpdateSettingsRequest(null, null, null, true))).EnsureSuccessStatusCode();

    private async Task<HttpResponseMessage> UploadAsync(string fixture, byte[]? image = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/receipts") { Content = new ByteArrayContent(image ?? Png()) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        request.Headers.Add("X-Receipt-Fixture", fixture);
        return await _client.SendAsync(request);
    }

    private async Task<ReceiptDraftDto> ReadAsync(string fixture)
    {
        var response = await UploadAsync(fixture);
        response.StatusCode.Should().Be(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        return (await response.ReadAsAsync<ReceiptDraftDto>())!;
    }

    private async Task<Guid> CategoryAsync(string name) =>
        (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!.First(c => c.Name == name).Id;

    // Gives the household some history: stores "Aldi" and "BJ's" and a few items.
    private async Task SeedHouseholdAsync()
    {
        var profile = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Mom"))).ReadAsAsync<ProfileDto>())!;
        var dairy = await CategoryAsync("Dairy");
        var pantry = await CategoryAsync("Pantry");
        await _client.PostJsonAsync($"/api/v1/profiles/{profile.Id}/trips", TestTrips.At("2026-08-01", "Aldi",
            TestTrips.Bought("Large Eggs", dairy, 2.50m), TestTrips.Bought("Mayonnaise", pantry, 3.10m),
            TestTrips.Bought("Reduced Sodium Chicken Broth", pantry, 1.40m), TestTrips.Bought("Popcorn", pantry, 2.80m)));
        await _client.PostJsonAsync($"/api/v1/profiles/{profile.Id}/trips", TestTrips.At("2026-08-02", "BJ's",
            TestTrips.Bought("Pirate's Booty", pantry, 9.00m)));
    }

    [Fact]
    public async Task Status_SaysWhetherItIsSetUpAndTurnedOn()
    {
        var status = (await (await _client.GetAsync("/api/v1/receipts/status")).ReadAsAsync<ReceiptStatusDto>())!;
        (status.Configured, status.Enabled).Should().Be((true, false));
        await EnableAsync();
        (await (await _client.GetAsync("/api/v1/receipts/status")).ReadAsAsync<ReceiptStatusDto>())!.Enabled.Should().BeTrue();
    }

    [Fact]
    public async Task Reading_IsRefusedUntilTurnedOn_AndWhenNotSetUp()
    {
        var off = await UploadAsync("aldi-enfield-2024-03-15");
        off.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await off.Content.ReadAsStringAsync()).Should().Contain("/errors/receipts-disabled");

        using var unconfigured = _factory.WithWebHostBuilder(b => b.UseSetting("Receipts:FixtureDir", ""));
        var client = unconfigured.CreateClient();
        (await client.PutJsonAsync("/api/v1/settings", new UpdateSettingsRequest(null, null, null, true))).EnsureSuccessStatusCode();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/receipts") { Content = new ByteArrayContent(Png()) };
        var response = await client.SendAsync(request);
        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await response.Content.ReadAsStringAsync()).Should().Contain("/errors/receipts-not-configured");
    }

    [Fact]
    public async Task AnAldiReceipt_ReadsIntoADraft_MatchedToTheHouseholdsStoreAndItems()
    {
        await SeedHouseholdAsync();
        await EnableAsync();

        var draft = await ReadAsync("aldi-enfield-2024-03-15");

        (draft.StoreRead, draft.StoreName, draft.Date).Should().Be(("ALDI", "Aldi", "2024-03-15"));
        (draft.Total, draft.LinesTotal, draft.TotalsMatch).Should().Be((23.50m, 23.50m, true));
        draft.Lines.Should().HaveCount(8);
        var butter = draft.Lines[0];
        (butter.Quantity, butter.Unit, butter.UnitPrice, butter.Amount).Should().Be((2m, "each", 2.75m, 5.50m));
        // Close names are suggested; nothing is trusted yet (no receipt has been applied).
        draft.Lines.Single(l => l.Text == "Large Eggs").Match!.Should().Match<ReceiptMatchDto>(m => m.ItemName == "Large Eggs" && m.Source == "suggested");
        draft.Lines.Single(l => l.Text == "Popcorn").Match!.ItemName.Should().Be("Popcorn");
        File.Exists(Path.Combine(DataDir, "receipts", draft.Id.ToString("N"))).Should().BeTrue();
        // The reader sorts products into the household's categories, for new items.
        draft.Lines.Single(l => l.Text == "CC Fudge Cookies").CategoryId.Should().Be(await CategoryAsync("Pantry"));
    }

    [Fact]
    public async Task Applying_LearnsTheStoresNames_DeletesThePhoto_AndOnlyHappensOnce()
    {
        await SeedHouseholdAsync();
        await EnableAsync();
        var pantry = await CategoryAsync("Pantry");
        var draft = await ReadAsync("aldi-jenison");
        var broth = draft.Lines.Single(l => l.Code == "343190");
        var kite = draft.Lines.Single(l => l.Text == "3D Kite");

        var result = await (await _client.PostJsonAsync($"/api/v1/receipts/{draft.Id}/apply", new ApplyReceiptRequest("Aldi",
            [new(broth.Id, "Reduced Sodium Chicken Broth", pantry), new(draft.Lines.Single(l => l.Text == "Lemons").Id, "Lemons", pantry)]))).ReadAsAsync<ApplyReceiptResultDto>();
        result!.AliasesLearned.Should().Be(2);
        result.Lines.Select(l => l.ItemName).Should().Equal("Reduced Sodium Chicken Broth", "Lemons"); // Lemons is a new item
        File.Exists(Path.Combine(DataDir, "receipts", draft.Id.ToString("N"))).Should().BeFalse();
        (await _client.PostJsonAsync($"/api/v1/receipts/{draft.Id}/apply", new ApplyReceiptRequest("Aldi", [])))
            .StatusCode.Should().Be(HttpStatusCode.Conflict);

        // The next Aldi receipt with that item number matches it without asking.
        var again = await ReadAsync("aldi-jenison");
        again.Lines.Single(l => l.Code == "343190").Match!.Should().Match<ReceiptMatchDto>(m => m.ItemName == "Reduced Sodium Chicken Broth" && m.Source == "alias");
        again.Lines.Single(l => l.Text == "3D Kite").Match.Should().BeNull();
        kite.Kind.Should().Be("item"); // non-grocery lines are still lines; the review can leave them out
    }

    [Fact]
    public async Task WeighedLines_KeepTheirWeight_AndAMissingTotalIsntAMismatch()
    {
        await EnableAsync();
        var draft = await ReadAsync("aldi-jenison");
        var zucchini = draft.Lines.Single(l => l.Text == "Zucchini");
        (zucchini.Quantity, zucchini.Unit, zucchini.UnitPrice, zucchini.Amount).Should().Be((1.55m, "lb", 1.45m, 2.25m));
        (draft.Total, draft.Difference, draft.TotalsMatch).Should().Be((null, 0m, true));
        draft.StoreName.Should().Be("ALDI"); // no household store yet: as printed
    }

    [Fact]
    public async Task LinesThatDontAddUp_AreFlaggedWithTheDifference()
    {
        await EnableAsync();
        var draft = await ReadAsync("aldi-blue-bell-2021-09-19");
        draft.Tax.Should().Be(0.14m);
        draft.Lines.Should().ContainSingle(l => l.Kind == "tax");
        (draft.TotalsMatch, draft.Difference).Should().Be((false, -1.40m));
    }

    [Fact]
    public async Task ACoupon_IsTheItemsDiscount_AndBjsMatchesTheHouseholdStore()
    {
        await SeedHouseholdAsync();
        await EnableAsync();
        var draft = await ReadAsync("bjs-brooklyn-2016-01-02");
        draft.StoreName.Should().Be("BJ's");
        var pirate = draft.Lines.Single(l => l.Text == "PIRATE 36CT");
        (pirate.Amount, pirate.Discount).Should().Be((8.99m, 1.00m));
        draft.TotalsMatch.Should().BeTrue();
        draft.Lines.Should().NotContain(l => l.Text.Contains("CPN"));
    }

    [Fact]
    public async Task Suggestions_CanBeShownForAnotherStore()
    {
        await SeedHouseholdAsync();
        await EnableAsync();
        var pantry = await CategoryAsync("Pantry");
        var first = await ReadAsync("bjs-newark-2022-11-18");
        await _client.PostJsonAsync($"/api/v1/receipts/{first.Id}/apply", new ApplyReceiptRequest("BJ's", [new(first.Lines[0].Id, "Water", pantry)]));

        var second = await ReadAsync("bjs-newark-2022-11-18");
        second.Lines[0].Match!.Source.Should().Be("alias");
        var elsewhere = (await (await _client.GetAsync($"/api/v1/receipts/{second.Id}?store=Aldi")).ReadAsAsync<ReceiptDraftDto>())!;
        elsewhere.StoreName.Should().Be("Aldi");
        elsewhere.Lines[0].Match?.Source.Should().NotBe("alias"); // an alias belongs to its store
    }

    [Fact]
    public async Task Discarding_RemovesTheDraftAndPhoto_AndOldDraftsAreCleanedUp()
    {
        await EnableAsync();
        var discarded = await ReadAsync("bjs-newark-2022-11-18");
        (await _client.DeleteAsync($"/api/v1/receipts/{discarded.Id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        File.Exists(Path.Combine(DataDir, "receipts", discarded.Id.ToString("N"))).Should().BeFalse();
        (await _client.GetAsync($"/api/v1/receipts/{discarded.Id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);

        var forgotten = await ReadAsync("bjs-newark-2022-11-18");
        _factory.Clock!.Advance(TimeSpan.FromDays(8));
        await ReadAsync("bjs-sanford-2023-06-16"); // any new read tidies up
        (await _client.GetAsync($"/api/v1/receipts/{forgotten.Id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        File.Exists(Path.Combine(DataDir, "receipts", forgotten.Id.ToString("N"))).Should().BeFalse();
    }

    [Fact]
    public async Task PastedText_IsReadToo()
    {
        await EnableAsync();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/receipts/text")
        {
            Content = JsonContent(new ReceiptTextRequest("SCOOP AWAY 2 @ 15.99 31.98 T\nFL 7% Tax 0.38\nTOTAL 32.36")),
        };
        request.Headers.Add("X-Receipt-Fixture", "bjs-sanford-2023-06-16");
        var draft = (await (await _client.SendAsync(request)).ReadAsAsync<ReceiptDraftDto>())!;
        (draft.Total, draft.Tax, draft.TotalsMatch).Should().Be((32.36m, 0.38m, true));
        draft.Lines[0].Quantity.Should().Be(2m);
    }

    [Fact]
    public async Task BadUploads_AreRefused()
    {
        await EnableAsync();
        (await UploadAsync("aldi-jenison", "not a picture"u8.ToArray())).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await UploadAsync("aldi-jenison", Png(10 * 1024 * 1024 + 1))).StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        var unknown = await UploadAsync("no-such-receipt");
        unknown.StatusCode.Should().Be(HttpStatusCode.BadGateway);
        (await unknown.Content.ReadAsStringAsync()).Should().Contain("/errors/receipt-unreadable");
    }

    [Fact]
    public async Task ReceiptNames_ShowOnTheItem_CanBeRemoved_AndFollowAMerge()
    {
        await SeedHouseholdAsync();
        await EnableAsync();
        var pantry = await CategoryAsync("Pantry");
        var draft = await ReadAsync("bjs-newark-2022-11-18");
        var applied = await (await _client.PostJsonAsync($"/api/v1/receipts/{draft.Id}/apply", new ApplyReceiptRequest("BJ's", [new(draft.Lines[0].Id, "WF Water", pantry)]))).ReadAsAsync<ApplyReceiptResultDto>();
        var source = applied!.Lines[0].ItemId;
        var water = (await (await _client.PostJsonAsync("/api/v1/items", new SaveItemRequest("Water", pantry))).ReadAsAsync<CatalogItemDto>())!;

        (await (await _client.GetAsync($"/api/v1/items/{source}/aliases")).ReadAsAsync<List<ItemAliasDto>>())!
            .Should().ContainSingle(a => a.StoreName == "BJ's" && a.Label == "WF WATER");
        (await _client.PostJsonAsync($"/api/v1/items/{source}/merge", new MergeItemRequest(water.Id, null, true))).EnsureSuccessStatusCode();
        var moved = (await (await _client.GetAsync($"/api/v1/items/{water.Id}/aliases")).ReadAsAsync<List<ItemAliasDto>>())!;
        moved.Should().ContainSingle();

        (await _client.DeleteAsync($"/api/v1/item-aliases/{moved[0].Id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await (await _client.GetAsync($"/api/v1/items/{water.Id}/aliases")).ReadAsAsync<List<ItemAliasDto>>())!.Should().BeEmpty();
    }

    [Fact]
    public async Task ReceiptNames_CanBeCorrected_MovedToAnotherItem_AndAddedByHand()
    {
        await SeedHouseholdAsync();
        await EnableAsync();
        var pantry = await CategoryAsync("Pantry");
        var draft = await ReadAsync("aldi-jenison");
        var broth = draft.Lines.Single(l => l.Code == "343190");
        var applied = await (await _client.PostJsonAsync($"/api/v1/receipts/{draft.Id}/apply",
            new ApplyReceiptRequest("Aldi", [new(broth.Id, "Beef Broth", pantry)]))).ReadAsAsync<ApplyReceiptResultDto>(); // the wrong item
        var wrong = applied!.Lines[0].ItemId;
        var alias = (await (await _client.GetAsync($"/api/v1/items/{wrong}/aliases")).ReadAsAsync<List<ItemAliasDto>>())!.Single();
        (alias.Label, alias.Code, alias.ItemName).Should().Be(("Redcd Sodium Broth", "343190", "Beef Broth"));

        // Correct it: it's really the chicken broth.
        var right = (await (await _client.GetAsync("/api/v1/catalog/items")).ReadAsAsync<List<CatalogItemDto>>())!.Single(i => i.Name == "Reduced Sodium Chicken Broth").Id;
        var moved = await (await _client.PutJsonAsync($"/api/v1/item-aliases/{alias.Id}", new SaveItemAliasRequest("Aldi", "Redcd Sodium Broth", "343190", right))).ReadAsAsync<ItemAliasDto>();
        (moved!.ItemId, moved.ItemName).Should().Be((right, "Reduced Sodium Chicken Broth"));
        (await (await _client.GetAsync($"/api/v1/items/{wrong}/aliases")).ReadAsAsync<List<ItemAliasDto>>())!.Should().BeEmpty();
        var again = await ReadAsync("aldi-jenison");
        again.Lines.Single(l => l.Code == "343190").Match!.ItemName.Should().Be("Reduced Sodium Chicken Broth");

        // Added by hand, keyed by its printed text (no code) …
        var added = await _client.PostJsonAsync($"/api/v1/items/{right}/aliases", new SaveItemAliasRequest("Aldi", "Lemons", null));
        added.StatusCode.Should().Be(HttpStatusCode.Created);
        var byHand = (await added.ReadAsAsync<ItemAliasDto>())!;
        (byHand.Code, byHand.TimesUsed).Should().Be((null, 0));
        // … which won't match a line printed with an item code: corrected to the code, it does.
        (await ReadAsync("aldi-jenison")).Lines.Single(l => l.Text == "Lemons").Match?.Source.Should().NotBe("alias");
        (await _client.PutJsonAsync($"/api/v1/item-aliases/{byHand.Id}", new SaveItemAliasRequest("Aldi", "Lemons", "356410"))).EnsureSuccessStatusCode();
        (await ReadAsync("aldi-jenison")).Lines.Single(l => l.Text == "Lemons").Match!.Source.Should().Be("alias");

        // Two names can't share a store and key; blank names are refused.
        (await _client.PostJsonAsync($"/api/v1/items/{right}/aliases", new SaveItemAliasRequest("Aldi", "Lemons (any text)", "356410"))).StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await _client.PutJsonAsync($"/api/v1/item-aliases/{byHand.Id}", new SaveItemAliasRequest("Aldi", "  ", null))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await _client.PutJsonAsync($"/api/v1/item-aliases/{Guid.NewGuid()}", new SaveItemAliasRequest("Aldi", "x", null))).StatusCode.Should().Be(HttpStatusCode.NotFound);
        // Moving it to another store is fine.
        (await (await _client.PutJsonAsync($"/api/v1/item-aliases/{byHand.Id}", new SaveItemAliasRequest("BJ's", "Lemons", null))).ReadAsAsync<ItemAliasDto>())!.StoreName.Should().Be("BJ's");
    }

    private static StringContent JsonContent<T>(T value) =>
        new(System.Text.Json.JsonSerializer.Serialize(value, JsonHelpers.Options), System.Text.Encoding.UTF8, "application/json");
}
