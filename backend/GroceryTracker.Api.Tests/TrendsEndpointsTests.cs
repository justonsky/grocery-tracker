using System.Net;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Fixed clock: "today" is 2026-08-15, so the default 90-day period is 2026-05-18..2026-08-15,
// its recent window 2026-07-17..2026-08-15, and the period before it 2026-02-17..2026-05-17.
public class TrendsEndpointsTests : IDisposable
{
    private static readonly DateTimeOffset FixedNow = new(2026, 8, 15, 12, 0, 0, TimeSpan.Zero);

    private readonly GroceryTrackerApiFactory _factory = new(FixedNow);
    private readonly HttpClient _client;

    public TrendsEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private async Task<Guid> NewProfileAsync(string name) =>
        (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest(name))).ReadAsAsync<ProfileDto>())!.Id;

    private async Task<TrendsDto> TrendsAsync(Guid profileId, string query = "")
    {
        var response = await _client.GetAsync($"/api/v1/profiles/{profileId}/trends{query}");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return (await response.ReadAsAsync<TrendsDto>())!;
    }

    private async Task<Guid> SeedHouseholdAsync()
    {
        var profileId = await NewProfileAsync("Trender");
        var categories = await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>();
        var dairy = categories!.First(c => c.Name == "Dairy").Id;
        var bakery = categories!.First(c => c.Name == "Bakery").Id;

        async Task TripAsync(string date, params (string Item, Guid Category, decimal Price)[] lines) =>
            await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
                TestTrips.At(date, "Aldi", lines.Select(l => TestTrips.Bought(l.Item, l.Category, l.Price)).ToArray()));

        // earlier part of the period
        await TripAsync("2026-05-20", ("Milk", dairy, 4m), ("Bread", bakery, 3m));
        await TripAsync("2026-06-03", ("Milk", dairy, 4m), ("Bread", bakery, 3m), ("Eggs", dairy, 5m));
        await TripAsync("2026-06-17", ("Milk", dairy, 4m), ("Bread", bakery, 3m));
        await TripAsync("2026-07-01", ("Milk", dairy, 4m), ("Bread", bakery, 3m));
        // recent window
        await TripAsync("2026-07-20", ("Bread", bakery, 3m), ("Eggs", dairy, 5m));
        await TripAsync("2026-07-30", ("Eggs", dairy, 5m), ("Oat milk", dairy, 6m));
        await TripAsync("2026-08-10", ("Bread", bakery, 3m), ("Eggs", dairy, 5m), ("Oat milk", dairy, 6m));
        // the period before, and one long ago: only the first counts, as the comparison
        await TripAsync("2026-03-01", ("Rice", dairy, 10m));
        await TripAsync("2025-01-01", ("Rice", dairy, 99m));
        return profileId;
    }

    [Fact]
    public async Task Trends_SummarisesThePeriod_AndComparesItWithThePreviousOne()
    {
        var trends = await TrendsAsync(await SeedHouseholdAsync());

        trends.Range.Should().Be("90d");
        (trends.From, trends.To, trends.RecentFrom).Should().Be(("2026-05-18", "2026-08-15", "2026-07-17"));
        trends.TripCount.Should().Be(7);
        trends.ItemCount.Should().Be(4);
        trends.Spent.Should().Be(66m);
        trends.PreviousTripCount.Should().Be(1);
        trends.PreviousSpent.Should().Be(10m);
        trends.EnoughData.Should().BeTrue();
    }

    [Fact]
    public async Task Trends_RanksMostBought_AndBiggestSpend()
    {
        var trends = await TrendsAsync(await SeedHouseholdAsync());

        trends.MostBought.Select(i => (i.Name, i.TimesBought)).Should()
            .Equal(("Bread", 6), ("Eggs", 4), ("Milk", 4), ("Oat milk", 2));
        trends.MostBought.First().AveragePrice.Should().Be(3m);
        trends.MostBought.First().LastBought.Should().Be("2026-08-10");
        trends.BiggestSpend.Select(i => (i.Name, i.Spent)).Should()
            .Equal(("Eggs", 20m), ("Bread", 18m), ("Milk", 16m), ("Oat milk", 12m));
        trends.Categories.Select(c => (c.Category, c.Spent)).Should().Equal(("Dairy", 48m), ("Bakery", 18m));
    }

    [Fact]
    public async Task Trends_FindsRisingItems_AndItemsThatWentQuiet()
    {
        var trends = await TrendsAsync(await SeedHouseholdAsync());

        // Eggs: once in the first 60 days, three times in the last 30 -> 6x as often. Oat milk is new.
        trends.Rising.Select(r => (r.Name, r.RecentCount, r.EarlierCount, r.Factor)).Should()
            .Equal(("Eggs", 3, 1, (double?)6.0), ("Oat milk", 2, 0, null));
        // Bread keeps its pace (not rising); Milk was a regular and hasn't been bought in the recent window.
        trends.Rising.Should().NotContain(r => r.Name == "Bread");
        var milk = trends.Fading.Should().ContainSingle().Which;
        (milk.Name, milk.EarlierCount, milk.LastBought, milk.WeeksSince).Should().Be(("Milk", 4, "2026-07-01", 6));
    }

    [Fact]
    public async Task Trends_AllTime_StartsAtTheFirstTrip_WithNothingBefore()
    {
        var trends = await TrendsAsync(await SeedHouseholdAsync(), "?range=all");

        trends.From.Should().Be("2025-01-01");
        trends.PreviousSpent.Should().BeNull();
        trends.PreviousTripCount.Should().BeNull();
        trends.TripCount.Should().Be(9);
        trends.Spent.Should().Be(66m + 10m + 99m);
    }

    [Fact]
    public async Task Trends_OnlyCountsTheProfilesOwnTrips()
    {
        await SeedHouseholdAsync();
        var other = await NewProfileAsync("Someone else");

        var trends = await TrendsAsync(other);

        trends.TripCount.Should().Be(0);
        trends.Spent.Should().Be(0m);
        trends.EnoughData.Should().BeFalse();
        trends.MostBought.Should().BeEmpty();
        trends.Rising.Should().BeEmpty();
        trends.Fading.Should().BeEmpty();
    }

    [Fact]
    public async Task Trends_IgnoresPlannedLines_AndFewTripsMeansNotEnoughData()
    {
        var profileId = await NewProfileAsync("Planner");
        var categories = await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>();
        var dairy = categories!.First(c => c.Name == "Dairy").Id;
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            TestTrips.At("2026-08-10", "Aldi", TestTrips.Planned("Milk", dairy), TestTrips.Bought("Eggs", dairy, 5m)));

        var trends = await TrendsAsync(profileId);

        trends.TripCount.Should().Be(1);
        trends.ItemCount.Should().Be(1); // Milk is only planned — no price, not bought
        trends.EnoughData.Should().BeFalse();
    }

    [Fact]
    public async Task Trends_EmptyAllTime_DoesNotFail()
    {
        var trends = await TrendsAsync(await NewProfileAsync("Brand new"), "?range=all");
        trends.TripCount.Should().Be(0);
        trends.From.Should().Be(trends.To);
    }

    [Fact]
    public async Task Trends_RejectsAnUnknownRange_AndAnUnknownProfile()
    {
        var profileId = await NewProfileAsync("Ranger");
        (await _client.GetAsync($"/api/v1/profiles/{profileId}/trends?range=7d")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await _client.GetAsync($"/api/v1/profiles/{Guid.NewGuid()}/trends")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Trends_CountsTaxAndTipsAsSpend_ButNotAsItems()
    {
        var profileId = await NewProfileAsync("Taxed");
        var categories = await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>();
        var dairy = categories!.First(c => c.Name == "Dairy").Id;
        var other = categories!.First(c => c.Name == "Other").Id;
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            TestTrips.At("2026-08-10", "Aldi", TestTrips.Bought("Milk", dairy, 4m), TestTrips.Bought("Tax", other, 2m),
                TestTrips.Bought("Unlisted purchases", other, 30m)));

        var trends = await TrendsAsync(profileId);

        trends.Spent.Should().Be(36m);
        trends.ItemCount.Should().Be(1);
        trends.MostBought.Select(i => i.Name).Should().Equal("Milk");
        trends.BiggestSpend.Select(i => i.Name).Should().Equal("Milk");
        trends.Categories.Select(c => (c.Category, c.Spent)).Should().Equal(("Other", 32m), ("Dairy", 4m));
    }
}
