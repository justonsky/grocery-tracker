using System.Net;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

public class ItemHistoryEndpointsTests : IDisposable
{
    private readonly GroceryTrackerApiFactory _factory = new();
    private readonly HttpClient _client;

    public ItemHistoryEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task ItemHistory_ComputesStatsAndDeltas()
    {
        var profileId = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("History Tester")))
            .ReadAsAsync<ProfileDto>())!.Id;
        var categoryId = (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!
            .First(c => c.Name == "Dairy").Id;

        var firstTrip = await (await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("2026-07-01", "Costco", [new TripItemInput("Whole Milk", categoryId, 3.00m)])))
            .ReadAsAsync<TripDto>();
        var itemId = firstTrip!.Items[0].ItemId;

        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("2026-07-15", "Safeway", [new TripItemInput("Whole Milk", categoryId, 4.50m)]));
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("2026-08-01", "Costco", [new TripItemInput("Whole Milk", categoryId, 2.50m)]));

        var history = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/items/{itemId}/history"))
            .ReadAsAsync<ItemHistoryDto>();

        history!.Current.Should().Be(2.50m);
        history.Lowest.Should().Be(2.50m);
        history.Highest.Should().Be(4.50m);
        history.Average.Should().Be((3.00m + 4.50m + 2.50m) / 3);
        history.History.Should().HaveCount(3);
        history.History[0].Date.Should().Be("2026-08-01"); // most recent first
        history.History[0].DeltaFromPrevious.Should().Be(2.50m - 4.50m);
        history.History[^1].DeltaFromPrevious.Should().BeNull(); // earliest purchase has no prior delta
    }

    [Fact]
    public async Task ItemHistory_ForUnknownItem_ReturnsNotFound()
    {
        var profileId = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("No Item")))
            .ReadAsAsync<ProfileDto>())!.Id;

        var response = await _client.GetAsync($"/api/v1/profiles/{profileId}/items/{Guid.NewGuid()}/history");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
