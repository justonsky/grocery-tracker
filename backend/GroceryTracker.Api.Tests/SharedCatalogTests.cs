using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Items and stores are one household catalogue: every profile resolves "Milk" to
// the same item, and its prices pool across profiles. Trips and spend do not.
public class SharedCatalogTests : IDisposable
{
    private readonly GroceryTrackerApiFactory _factory = new();
    private readonly HttpClient _client;

    public SharedCatalogTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private async Task<Guid> CreateProfileAsync(string name) =>
        (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest(name))).ReadAsAsync<ProfileDto>())!.Id;

    private async Task<Guid> DairyIdAsync() =>
        (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!.First(c => c.Name == "Dairy").Id;

    [Fact]
    public async Task SameItemName_FromTwoProfiles_IsOneItem_WithPooledPrices()
    {
        var alex = await CreateProfileAsync("Alex");
        var sam = await CreateProfileAsync("Sam");
        var dairyId = await DairyIdAsync();

        var alexTrip = await (await _client.PostJsonAsync($"/api/v1/profiles/{alex}/trips",
            TestTrips.At("2026-07-01", "Costco", TestTrips.Bought("Whole Milk", dairyId, 3.00m)))).ReadAsAsync<TripDto>();
        var samTrip = await (await _client.PostJsonAsync($"/api/v1/profiles/{sam}/trips",
            TestTrips.At("2026-08-01", "costco", TestTrips.Bought("whole milk", dairyId, 4.00m)))).ReadAsAsync<TripDto>();

        samTrip!.Items.Single().ItemId.Should().Be(alexTrip!.Items.Single().ItemId);

        var items = await (await _client.GetAsync("/api/v1/items")).ReadAsAsync<List<ItemDto>>();
        var milk = items.Should().ContainSingle().Subject;
        milk.AveragePrice.Should().Be(3.50m);
        milk.LastPrice.Should().Be(4.00m);

        var stores = await (await _client.GetAsync("/api/v1/stores")).ReadAsAsync<List<StoreDto>>();
        stores.Should().ContainSingle();

        var history = await (await _client.GetAsync($"/api/v1/items/{milk.Id}/history")).ReadAsAsync<ItemHistoryDto>();
        history!.History.Should().HaveCount(2);
    }

    [Fact]
    public async Task SpendStaysPerProfile_AndDeletingAProfileKeepsTheCatalogue()
    {
        var alex = await CreateProfileAsync("Alex");
        var sam = await CreateProfileAsync("Sam");
        var dairyId = await DairyIdAsync();

        await _client.PostJsonAsync($"/api/v1/profiles/{alex}/trips",
            TestTrips.At(DateTime.UtcNow.ToString("yyyy-MM-dd"), "Costco", TestTrips.Bought("Whole Milk", dairyId, 3.00m)));

        var samDashboard = await (await _client.GetAsync($"/api/v1/profiles/{sam}/dashboard")).ReadAsAsync<DashboardSummaryDto>();
        samDashboard!.YearSpend.Should().Be(0m);

        (await _client.DeleteAsync($"/api/v1/profiles/{alex}")).IsSuccessStatusCode.Should().BeTrue();

        // The item survives for everyone else; its price history went with Alex's trips.
        var items = await (await _client.GetAsync("/api/v1/items")).ReadAsAsync<List<ItemDto>>();
        items.Should().ContainSingle(i => i.Name == "Whole Milk").Which.AveragePrice.Should().BeNull();
    }

    [Fact]
    public async Task LegacyProfileScopedRoutes_StillServeTheHouseholdCatalogue()
    {
        // What a PWA still running its pre-update build calls.
        var alex = await CreateProfileAsync("Alex");
        var sam = await CreateProfileAsync("Sam");
        var dairyId = await DairyIdAsync();
        await _client.PostJsonAsync($"/api/v1/profiles/{alex}/trips",
            TestTrips.At("2026-07-01", "Costco", TestTrips.Bought("Whole Milk", dairyId, 3.00m)));

        var items = await (await _client.GetAsync($"/api/v1/profiles/{sam}/items")).ReadAsAsync<List<ItemDto>>();
        items.Should().ContainSingle(i => i.Name == "Whole Milk");
        var stores = await (await _client.GetAsync($"/api/v1/profiles/{sam}/stores")).ReadAsAsync<List<StoreDto>>();
        stores.Should().ContainSingle(s => s.Name == "Costco");
    }

    [Fact]
    public async Task UnknownApiRoute_Is404ProblemDetails_NotTheAppShell()
    {
        var response = await _client.GetAsync("/api/v1/no-such-thing");

        response.StatusCode.Should().Be(System.Net.HttpStatusCode.NotFound);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
    }
}
