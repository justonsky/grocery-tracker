using System.Net;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Fixed clock so today/month/year bucketing is deterministic regardless of when the
// test suite actually runs.
public class DashboardEndpointsTests : IDisposable
{
    private static readonly DateTimeOffset FixedNow = new(2026, 8, 15, 12, 0, 0, TimeSpan.Zero);

    private readonly GroceryTrackerApiFactory _factory = new(FixedNow);
    private readonly HttpClient _client;

    public DashboardEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task Dashboard_BucketsSpendByTodayMonthYear()
    {
        var profileId = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Dashboard Tester")))
            .ReadAsAsync<ProfileDto>())!.Id;
        var categories = await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>();
        var categoryId = categories!.First(c => c.Name == "Dairy").Id;

        async Task CreateTripAsync(string date, decimal price) =>
            await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
                new TripInput(date, "Store", [new TripItemInput("Milk", categoryId, price)]));

        await CreateTripAsync("2026-08-15", 10.00m); // today
        await CreateTripAsync("2026-08-05", 5.00m);  // this month, not today
        await CreateTripAsync("2026-01-01", 20.00m); // this year, not this month
        await CreateTripAsync("2025-08-15", 99.00m); // previous year — excluded entirely

        var dashboard = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/dashboard")).ReadAsAsync<DashboardSummaryDto>();

        dashboard!.TodaySpend.Should().Be(10.00m);
        dashboard.TodayCount.Should().Be(1);
        dashboard.MonthSpend.Should().Be(15.00m);
        dashboard.MonthCount.Should().Be(2);
        dashboard.YearSpend.Should().Be(35.00m);
        dashboard.YearCount.Should().Be(3);
        dashboard.RecentTrip.Should().NotBeNull();
        dashboard.RecentTrip!.Date.Should().Be("2026-08-15");
        dashboard.TrackedItems.Should().ContainSingle(i => i.ItemName == "Milk");
    }

    [Fact]
    public async Task Dashboard_ForProfileWithNoTrips_ReturnsZeroes()
    {
        var profileId = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Empty")))
            .ReadAsAsync<ProfileDto>())!.Id;

        var dashboard = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/dashboard")).ReadAsAsync<DashboardSummaryDto>();

        dashboard!.TodaySpend.Should().Be(0m);
        dashboard.RecentTrip.Should().BeNull();
        dashboard.TrackedItems.Should().BeEmpty();
    }
}
