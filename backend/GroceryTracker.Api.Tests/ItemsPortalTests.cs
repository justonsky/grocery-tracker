using System.Net;
using System.Text.Json;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// The dashboard grid, date-ranged item history, and the Items portal (catalogue
// edits, purchase records, merging).
public class ItemsPortalTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 9, 1, 12, 0, 0, TimeSpan.Zero);

    private readonly GroceryTrackerApiFactory _factory = new(Now);
    private readonly HttpClient _client;

    public ItemsPortalTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private async Task<Guid> CreateProfileAsync(string name = "Alex") =>
        (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest(name))).ReadAsAsync<ProfileDto>())!.Id;

    private async Task<Guid> CategoryIdAsync(string name = "Dairy") =>
        (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!.First(c => c.Name == name).Id;

    private async Task<TripDto> BuyAsync(Guid profileId, string date, string store, params (string Name, decimal Price)[] items)
    {
        var dairy = await CategoryIdAsync();
        var response = await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            TestTrips.At(date, store, items.Select(i => TestTrips.Bought(i.Name, dairy, i.Price)).ToArray()));
        return (await response.ReadAsAsync<TripDto>())!;
    }

    private async Task<List<CatalogItemDto>> CatalogAsync() =>
        (await (await _client.GetAsync("/api/v1/catalog/items")).ReadAsAsync<List<CatalogItemDto>>())!;

    private static async Task<string?> ProblemTypeAsync(HttpResponseMessage response)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.TryGetProperty("type", out var type) ? type.GetString() : null;
    }

    // --- Dashboard grid ---------------------------------------------------------

    [Fact]
    public async Task Grid_DefaultsToTheEightMostRecentItems()
    {
        var profileId = await CreateProfileAsync();
        for (var day = 1; day <= 10; day++)
        {
            await BuyAsync(profileId, $"2026-08-{day:00}", "Aldi", ($"Item {day}", day));
        }

        var dashboard = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/dashboard")).ReadAsAsync<DashboardSummaryDto>();

        dashboard!.TrackedItemsCustomized.Should().BeFalse();
        dashboard.TrackedItems.Select(t => t.ItemName).Should().Equal(Enumerable.Range(3, 8).Reverse().Select(d => $"Item {d}"));
    }

    [Fact]
    public async Task Grid_NewProfile_StartsWithTheHouseholdsRecentItems()
    {
        var alex = await CreateProfileAsync("Alex");
        await BuyAsync(alex, "2026-08-01", "Aldi", ("Milk", 3m));
        var sam = await CreateProfileAsync("Sam");

        var dashboard = await (await _client.GetAsync($"/api/v1/profiles/{sam}/dashboard")).ReadAsAsync<DashboardSummaryDto>();
        dashboard!.TrackedItems.Should().ContainSingle(t => t.ItemName == "Milk" && t.LastPrice == 3m);
    }

    [Fact]
    public async Task Grid_CanBeCustomized_IncludingNeverBoughtItems_AndReset()
    {
        var profileId = await CreateProfileAsync();
        var trip = await BuyAsync(profileId, "2026-08-01", "Aldi", ("Milk", 3m), ("Eggs", 4m));
        var eggs = trip.Items.Single(i => i.ItemName == "Eggs").ItemId;
        var saffron = (await (await _client.PostJsonAsync("/api/v1/items", new SaveItemRequest("Saffron", null))).ReadAsAsync<CatalogItemDto>())!.Id;

        var set = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/dashboard/tracked-items",
            new SetTrackedItemsRequest([saffron, eggs, Guid.NewGuid()]));
        set.StatusCode.Should().Be(HttpStatusCode.OK);

        var dashboard = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/dashboard")).ReadAsAsync<DashboardSummaryDto>();
        dashboard!.TrackedItemsCustomized.Should().BeTrue();
        // In the chosen order; the unknown id is dropped; an unbought item has no price.
        dashboard.TrackedItems.Select(t => t.ItemName).Should().Equal("Saffron", "Eggs");
        dashboard.TrackedItems[0].LastPrice.Should().BeNull();

        // An emptied grid stays empty rather than falling back to automatic...
        await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/dashboard/tracked-items", new SetTrackedItemsRequest([]));
        (await (await _client.GetAsync($"/api/v1/profiles/{profileId}/dashboard")).ReadAsAsync<DashboardSummaryDto>())!
            .TrackedItems.Should().BeEmpty();

        // ...until it's reset.
        await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/dashboard/tracked-items", new SetTrackedItemsRequest(null));
        var reset = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/dashboard")).ReadAsAsync<DashboardSummaryDto>();
        reset!.TrackedItemsCustomized.Should().BeFalse();
        reset.TrackedItems.Should().HaveCount(2);
    }

    [Fact]
    public async Task Grid_ForUnknownProfile_IsProfileNotFound()
    {
        var response = await _client.PutJsonAsync($"/api/v1/profiles/{Guid.NewGuid()}/dashboard/tracked-items", new SetTrackedItemsRequest([]));
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ProblemTypeAsync(response)).Should().Be(ProblemTypes.ProfileNotFound);
    }

    // --- Item history date range -------------------------------------------------

    [Fact]
    public async Task History_DateRange_RecalculatesEveryStatistic()
    {
        var profileId = await CreateProfileAsync();
        var first = await BuyAsync(profileId, "2026-06-01", "Aldi", ("Milk", 2m));
        await BuyAsync(profileId, "2026-07-01", "Aldi", ("Milk", 4m));
        await BuyAsync(profileId, "2026-08-01", "Costco", ("Milk", 6m));
        var milk = first.Items[0].ItemId;

        var ranged = await (await _client.GetAsync($"/api/v1/items/{milk}/history?from=2026-07-01&to=2026-08-31")).ReadAsAsync<ItemHistoryDto>();

        ranged!.PurchaseCount.Should().Be(2);
        ranged.Average.Should().Be(5m);
        ranged.Lowest.Should().Be(4m);
        ranged.Highest.Should().Be(6m);
        ranged.Current.Should().Be(6m);
        ranged.Variance.Should().Be(1m);
        ranged.History.Select(h => h.Date).Should().Equal("2026-08-01", "2026-07-01");
        // The first in-range purchase still compares with the one before the range.
        ranged.History[^1].DeltaFromPrevious.Should().Be(2m);
        ranged.FirstDate.Should().Be("2026-06-01");
        ranged.LastDate.Should().Be("2026-08-01");

        var empty = await (await _client.GetAsync($"/api/v1/items/{milk}/history?from=2025-01-01&to=2025-12-31")).ReadAsAsync<ItemHistoryDto>();
        empty!.PurchaseCount.Should().Be(0);
        empty.History.Should().BeEmpty();

        (await _client.GetAsync($"/api/v1/items/{milk}/history?from=last-week")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // --- Catalogue edits ----------------------------------------------------------

    [Fact]
    public async Task Catalog_CreateRenameAndDelete()
    {
        var produce = await CategoryIdAsync("Produce");

        var created = await _client.PostJsonAsync("/api/v1/items", new SaveItemRequest("  Kale ", produce));
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var kale = (await created.ReadAsAsync<CatalogItemDto>())!;
        kale.Name.Should().Be("Kale");
        kale.CategoryName.Should().Be("Produce");

        (await _client.PostJsonAsync("/api/v1/items", new SaveItemRequest("kale", null))).StatusCode.Should().Be(HttpStatusCode.Conflict);

        var renamed = await (await _client.PutJsonAsync($"/api/v1/items/{kale.Id}", new SaveItemRequest("Lacinato Kale", produce))).ReadAsAsync<CatalogItemDto>();
        renamed!.Name.Should().Be("Lacinato Kale");

        (await _client.DeleteAsync($"/api/v1/items/{kale.Id}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await CatalogAsync()).Should().NotContain(i => i.Id == kale.Id);
    }

    [Fact]
    public async Task Catalog_RenameOntoAnExistingName_IsAConflict()
    {
        var profileId = await CreateProfileAsync();
        var trip = await BuyAsync(profileId, "2026-08-01", "Aldi", ("Milk", 3m), ("Whole Milk", 4m));
        var milk = trip.Items.Single(i => i.ItemName == "Milk").ItemId;

        var response = await _client.PutJsonAsync($"/api/v1/items/{milk}", new SaveItemRequest("whole milk", null));
        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await ProblemTypeAsync(response)).Should().Be(ProblemTypes.ItemNameConflict);
    }

    [Fact]
    public async Task DeletingAnItem_RemovesItsPurchaseRecords()
    {
        var profileId = await CreateProfileAsync();
        var trip = await BuyAsync(profileId, "2026-08-01", "Aldi", ("Milk", 3m), ("Eggs", 4m));

        await _client.DeleteAsync($"/api/v1/items/{trip.Items.Single(i => i.ItemName == "Milk").ItemId}");

        var reloaded = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/trips/{trip.Id}")).ReadAsAsync<TripDto>();
        reloaded!.Items.Should().ContainSingle(i => i.ItemName == "Eggs");
    }

    // --- Purchase records ---------------------------------------------------------

    [Fact]
    public async Task Lines_CanBeAddedEditedMovedAndRemoved()
    {
        var profileId = await CreateProfileAsync();
        var august = await BuyAsync(profileId, "2026-08-01", "Aldi", ("Milk", 3m));
        var july = await BuyAsync(profileId, "2026-07-01", "Aldi", ("Eggs", 4m));
        var milk = august.Items[0].ItemId;
        var lineId = august.Items[0].Id;

        // Edit price and store.
        var edited = await (await _client.PutJsonAsync($"/api/v1/items/{milk}/lines/{lineId}",
            new SaveItemLineRequest(august.Id, "Costco", 3.25m))).ReadAsAsync<ItemLineDto>();
        edited!.Price.Should().Be(3.25m);
        edited.StoreName.Should().Be("Costco");
        // The store joins the trip's own store list so the trip editor shows it.
        var augustReloaded = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/trips/{august.Id}")).ReadAsAsync<TripDto>();
        augustReloaded!.Stores.Should().Contain("Costco");

        // Move it to the July trip.
        var moved = await (await _client.PutJsonAsync($"/api/v1/items/{milk}/lines/{lineId}",
            new SaveItemLineRequest(july.Id, "Aldi", 3.25m))).ReadAsAsync<ItemLineDto>();
        moved!.TripId.Should().Be(july.Id);
        moved.TripDate.Should().Be("2026-07-01");

        // Add a second record to the August trip.
        var added = await _client.PostJsonAsync($"/api/v1/items/{milk}/lines", new SaveItemLineRequest(august.Id, null, 2.99m));
        added.StatusCode.Should().Be(HttpStatusCode.Created);

        var lines = await (await _client.GetAsync($"/api/v1/items/{milk}/lines")).ReadAsAsync<List<ItemLineDto>>();
        lines!.Select(l => (l.TripDate, l.Price)).Should().BeEquivalentTo(new[] { ("2026-08-01", (decimal?)2.99m), ("2026-07-01", (decimal?)3.25m) });

        (await _client.DeleteAsync($"/api/v1/items/{milk}/lines/{lineId}")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await (await _client.GetAsync($"/api/v1/items/{milk}/lines")).ReadAsAsync<List<ItemLineDto>>()).Should().ContainSingle();
    }

    [Fact]
    public async Task LockedLine_NeedsExplicitConfirmationToCorrect()
    {
        var profileId = await CreateProfileAsync();
        var trip = await BuyAsync(profileId, "2026-08-01", "Aldi", ("Milk", 3m));
        var milk = trip.Items[0].ItemId;
        _factory.Clock!.Advance(TimeSpan.FromDays(8));

        var refused = await _client.PutJsonAsync($"/api/v1/items/{milk}/lines/{trip.Items[0].Id}", new SaveItemLineRequest(trip.Id, "Aldi", 2.50m));
        refused.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await ProblemTypeAsync(refused)).Should().Be(ProblemTypes.PriceLocked);

        var corrected = await (await _client.PutJsonAsync($"/api/v1/items/{milk}/lines/{trip.Items[0].Id}",
            new SaveItemLineRequest(trip.Id, "Aldi", 2.50m, ConfirmLocked: true))).ReadAsAsync<ItemLineDto>();
        corrected!.Price.Should().Be(2.50m);
        // Still locked for the trip editor afterwards.
        corrected.PriceLocked.Should().BeTrue();
    }

    // --- Merging --------------------------------------------------------------------

    [Fact]
    public async Task Merge_MovesEveryRecord_AndRemovesTheSource()
    {
        var profileId = await CreateProfileAsync();
        var trip = await BuyAsync(profileId, "2026-08-01", "Aldi", ("Milk", 3m), ("Whole Milk", 4m));
        await BuyAsync(profileId, "2026-08-05", "Costco", ("Milk", 3.5m));
        var milk = trip.Items.Single(i => i.ItemName == "Milk").ItemId;
        var wholeMilk = trip.Items.Single(i => i.ItemName == "Whole Milk").ItemId;
        await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/dashboard/tracked-items", new SetTrackedItemsRequest([milk]));

        var result = await (await _client.PostJsonAsync($"/api/v1/items/{milk}/merge", new MergeItemRequest(wholeMilk, null))).ReadAsAsync<MergeResultDto>();

        result!.Moved.Should().Be(2);
        result.SourceDeleted.Should().BeTrue();
        var catalog = await CatalogAsync();
        catalog.Should().NotContain(i => i.Id == milk);
        catalog.Single(i => i.Id == wholeMilk).PurchaseCount.Should().Be(3);
        // A dashboard that pinned "Milk" now shows "Whole Milk" instead.
        var dashboard = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/dashboard")).ReadAsAsync<DashboardSummaryDto>();
        dashboard!.TrackedItems.Should().ContainSingle(t => t.ItemId == wholeMilk);
    }

    [Fact]
    public async Task Merge_LimitedToOneStore_LeavesTheOtherStoresRecords()
    {
        var profileId = await CreateProfileAsync();
        var aldi = await BuyAsync(profileId, "2026-08-01", "Aldi", ("Milk", 3m), ("Whole Milk", 4m));
        await BuyAsync(profileId, "2026-08-05", "Costco", ("Milk", 3.5m));
        var milk = aldi.Items.Single(i => i.ItemName == "Milk").ItemId;
        var wholeMilk = aldi.Items.Single(i => i.ItemName == "Whole Milk").ItemId;

        var result = await (await _client.PostJsonAsync($"/api/v1/items/{milk}/merge", new MergeItemRequest(wholeMilk, "aldi"))).ReadAsAsync<MergeResultDto>();

        result!.Moved.Should().Be(1);
        result.SourceDeleted.Should().BeFalse();
        var remaining = await (await _client.GetAsync($"/api/v1/items/{milk}/lines")).ReadAsAsync<List<ItemLineDto>>();
        remaining.Should().ContainSingle().Which.EffectiveStoreName.Should().Be("Costco");
    }

    [Fact]
    public async Task Merge_IntoItself_IsRejected()
    {
        var profileId = await CreateProfileAsync();
        var trip = await BuyAsync(profileId, "2026-08-01", "Aldi", ("Milk", 3m));
        var milk = trip.Items[0].ItemId;

        (await _client.PostJsonAsync($"/api/v1/items/{milk}/merge", new MergeItemRequest(milk, null))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task HouseholdTrips_ListsEveryProfilesTrips()
    {
        var alex = await CreateProfileAsync("Alex");
        var sam = await CreateProfileAsync("Sam");
        await BuyAsync(alex, "2026-08-01", "Aldi", ("Milk", 3m));
        await BuyAsync(sam, "2026-08-02", "Costco", ("Eggs", 4m));

        var trips = await (await _client.GetAsync("/api/v1/trips")).ReadAsAsync<List<HouseholdTripDto>>();
        trips!.Select(t => t.ProfileName).Should().Equal("Sam", "Alex");
    }
}
