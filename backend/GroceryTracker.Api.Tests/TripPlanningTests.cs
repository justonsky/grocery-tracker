using System.Net;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Trips absorbed what grocery lists used to be: the same record, written before the
// shop (unchecked, unpriced) and completed after it. These cover the planning half.
// Fresh factory (and SQLite file) per test method for full isolation between tests.
public class TripPlanningTests : IDisposable
{
    private readonly GroceryTrackerApiFactory _factory = new();
    private readonly HttpClient _client;

    public TripPlanningTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private async Task<Guid> CreateProfileAsync() =>
        (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Trip Planner")))
            .ReadAsAsync<ProfileDto>())!.Id;

    private async Task<Guid> GetCategoryIdAsync(string name) =>
        (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!
            .First(c => c.Name == name).Id;

    [Fact]
    public async Task PlannedTrip_WithNameStoresAndBudget_RoundTrips()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");

        var input = new TripInput("Weekly stock-up", "2026-08-05", 160m,
            ["Costco", "Trader Joe's"],
            [TestTrips.Planned("Whole Milk", dairyId, "Costco")]);

        var response = await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips", input);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var trip = await response.ReadAsAsync<TripDto>();

        trip!.Name.Should().Be("Weekly stock-up");
        trip.Stores.Should().BeEquivalentTo(["Costco", "Trader Joe's"]);
        trip.Budget.Should().Be(160m);
        trip.Items.Should().ContainSingle(i => i.ItemName == "Whole Milk" && i.StoreName == "Costco" && !i.Checked);
        // Nothing bought yet, so the trip has no spend.
        trip.Items.Single().Price.Should().BeNull();
        trip.Total.Should().Be(0m);
    }

    [Fact]
    public async Task Trip_MixesPlannedAndBoughtItems_AndTotalsOnlyWhatWasBought()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");
        var produceId = await GetCategoryIdAsync("Produce");

        var trip = await (await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
                new TripInput("Half done", "2026-08-05", null, ["Aldi"],
                [
                    new TripItemInput("Whole Milk", dairyId, "Aldi", true, 3.49m),
                    new TripItemInput("Bananas", produceId, "Aldi", false, null),
                ])))
            .ReadAsAsync<TripDto>();

        trip!.Total.Should().Be(3.49m);
        trip.Items.Single(i => i.ItemName == "Bananas").Price.Should().BeNull();
        trip.Items.Single(i => i.ItemName == "Whole Milk").Checked.Should().BeTrue();
    }

    [Fact]
    public async Task Trip_BudgetIsOptional_AndRoundTripsThroughUpdate()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");

        TripInput WithBudget(decimal? budget) =>
            new("No budget", "2026-08-05", budget, [], [TestTrips.Planned("Whole Milk", dairyId)]);

        var created = await (await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips", WithBudget(null)))
            .ReadAsAsync<TripDto>();
        created!.Budget.Should().BeNull();

        // Setting a budget on an existing trip persists it...
        var updated = await (await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{created.Id}", WithBudget(42.50m)))
            .ReadAsAsync<TripDto>();
        updated!.Budget.Should().Be(42.50m);

        // ...and clearing it back to null works too.
        var cleared = await (await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{created.Id}", WithBudget(null)))
            .ReadAsAsync<TripDto>();
        cleared!.Budget.Should().BeNull();
    }

    [Fact]
    public async Task TripSummary_ReportsStoresCheckedCountAndBudget()
    {
        var profileId = await CreateProfileAsync();
        var produceId = await GetCategoryIdAsync("Produce");

        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("Big shop", "2026-08-05", 80m, ["Aldi", "HMart"],
            [
                new TripItemInput("Bananas", produceId, "Aldi", true, 1.20m),
                new TripItemInput("Carrot", produceId, "HMart", false, null),
            ]));

        var summaries = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/trips"))
            .ReadAsAsync<List<TripSummaryDto>>();

        var summary = summaries!.Should().ContainSingle().Subject;
        summary.Name.Should().Be("Big shop");
        summary.Stores.Should().BeEquivalentTo(["Aldi", "HMart"]);
        summary.ItemCount.Should().Be(2);
        summary.CheckedCount.Should().Be(1);
        summary.Total.Should().Be(1.20m);
        summary.Budget.Should().Be(80m);
    }

    [Fact]
    public async Task ItemSearch_ReportsLastPaidPrice_ForEstimatedTripCost()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");

        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            TestTrips.At("2026-07-01", "Costco", TestTrips.Bought("Whole Milk", dairyId, 3.00m)));
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            TestTrips.At("2026-08-01", "Safeway", TestTrips.Bought("Whole Milk", dairyId, 4.25m)));

        var items = await (await _client.GetAsync($"/api/v1/items")).ReadAsAsync<List<ItemDto>>();

        // Most recent purchase wins, so a trip's estimate reflects today's prices.
        items!.Should().ContainSingle(i => i.Name == "Whole Milk").Which.LastPrice.Should().Be(4.25m);
    }

    [Fact]
    public async Task ItemSearch_ForPlannedButNeverBoughtItem_ReportsNullLastPrice()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");

        // An item that only appears on a plan has no purchase history to estimate from.
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("Planning", "2026-08-05", null, [], [TestTrips.Planned("Saffron", dairyId)]));

        var items = await (await _client.GetAsync($"/api/v1/items")).ReadAsAsync<List<ItemDto>>();
        items!.Should().ContainSingle(i => i.Name == "Saffron").Which.LastPrice.Should().BeNull();
    }

    [Fact]
    public async Task PlannedItems_DoNotCountTowardDashboardSpendOrPriceHistory()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");

        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("Plan only", "2026-08-05", null, ["Aldi"], [TestTrips.Planned("Saffron", dairyId, "Aldi")]));

        var dashboard = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/dashboard"))
            .ReadAsAsync<DashboardSummaryDto>();

        dashboard!.YearSpend.Should().Be(0m);
        // An unbought item is not something you are "tracking the price of" yet.
        dashboard.TrackedItems.Should().BeEmpty();
    }

    [Fact]
    public async Task Trip_WithDuplicateStoreNameDifferentCaseInSamePayload_ResolvesToOneStore()
    {
        // Same fix as TripEndpointsTests' duplicate-item-name regression test,
        // but exercising LookupService.ResolveStoreAsync via per-item StoreName.
        var profileId = await CreateProfileAsync();
        var categoryId = await GetCategoryIdAsync("Produce");

        var input = new TripInput("Trip", "2026-08-05", null, ["Costco"],
        [
            TestTrips.Planned("Bananas", categoryId, "Costco"),
            TestTrips.Planned("Apples", categoryId, "costco"),
        ]);

        var response = await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips", input);
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var stores = await (await _client.GetAsync($"/api/v1/stores")).ReadAsAsync<List<StoreDto>>();
        stores.Should().ContainSingle(s => s.Name.Equals("costco", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task DeletePlannedTrip_RemovesIt()
    {
        var profileId = await CreateProfileAsync();
        var trip = await (await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
                new TripInput("Throwaway", "2026-08-05", null, [], [])))
            .ReadAsAsync<TripDto>();

        var deleteResponse = await _client.DeleteAsync($"/api/v1/profiles/{profileId}/trips/{trip!.Id}");
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var getResponse = await _client.GetAsync($"/api/v1/profiles/{profileId}/trips/{trip.Id}");
        getResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
