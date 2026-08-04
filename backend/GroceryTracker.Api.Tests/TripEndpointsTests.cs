using System.Net;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Fresh factory (and SQLite file) per test method for full isolation between tests.
public class TripEndpointsTests : IDisposable
{
    private readonly GroceryTrackerApiFactory _factory = new();
    private readonly HttpClient _client;

    public TripEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private async Task<Guid> CreateProfileAsync(string name = "Trip Tester")
    {
        var profile = await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest(name)))
            .ReadAsAsync<ProfileDto>();
        return profile!.Id;
    }

    private async Task<Guid> GetCategoryIdAsync(string name)
    {
        var categories = await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>();
        return categories!.First(c => c.Name == name).Id;
    }

    [Fact]
    public async Task CreateTrip_ResolvesStoreAndItemsAndComputesTotal()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");
        var produceId = await GetCategoryIdAsync("Produce");

        var input = new TripInput("2026-08-01", "Trader Joe's",
        [
            new TripItemInput("Whole Milk", dairyId, 3.49m),
            new TripItemInput("Bananas", produceId, 0.59m),
        ]);

        var createResponse = await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips", input);
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var trip = await createResponse.ReadAsAsync<TripDto>();

        trip!.StoreName.Should().Be("Trader Joe's");
        trip.Items.Should().HaveCount(2);
        trip.Total.Should().Be(4.08m);

        // Item/store rows should be reused (soft-normalized), not duplicated, on a second trip.
        var second = await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("2026-08-08", "trader joe's", [new TripItemInput("whole milk", dairyId, 3.59m)]));
        var secondTrip = await second.ReadAsAsync<TripDto>();
        secondTrip!.StoreId.Should().Be(trip.StoreId);
        secondTrip.Items[0].ItemId.Should().Be(trip.Items.First(i => i.ItemName == "Whole Milk").ItemId);

        var stores = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/stores")).ReadAsAsync<List<StoreDto>>();
        stores.Should().ContainSingle(s => s.Name == "Trader Joe's");
    }

    [Fact]
    public async Task CreateTrip_WithDuplicateItemNameDifferentCaseInSamePayload_CreatesOnlyOneItem()
    {
        // Regression test: LookupService.ResolveItemAsync used to check only the
        // database for an existing match, which can't see an Added-but-unsaved
        // entity — two references to the same new name within one payload both
        // missed, both got Added, and the second violated the unique index.
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");

        var input = new TripInput("2026-08-01", "Costco",
        [
            new TripItemInput("Milk", dairyId, 3.49m),
            new TripItemInput("milk", dairyId, 3.59m),
        ]);

        var response = await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips", input);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var trip = await response.ReadAsAsync<TripDto>();

        trip!.Items.Should().HaveCount(2);
        trip.Items.Select(i => i.ItemId).Distinct().Should().ContainSingle();

        var items = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/items")).ReadAsAsync<List<ItemDto>>();
        items.Should().ContainSingle(i => i.Name.Equals("milk", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task UpdateTrip_ReplacesItems()
    {
        var profileId = await CreateProfileAsync();
        var categoryId = await GetCategoryIdAsync("Pantry");

        var created = await (await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("2026-08-01", "Costco", [new TripItemInput("Pasta", categoryId, 1.79m)])))
            .ReadAsAsync<TripDto>();

        var updateResponse = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{created!.Id}",
            new TripInput("2026-08-02", "Costco", [new TripItemInput("Rice", categoryId, 4.99m)]));
        updateResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = await updateResponse.ReadAsAsync<TripDto>();

        updated!.Date.Should().Be("2026-08-02");
        updated.Items.Should().ContainSingle(i => i.ItemName == "Rice");
    }

    [Fact]
    public async Task DeleteTrip_RemovesIt()
    {
        var profileId = await CreateProfileAsync();
        var categoryId = await GetCategoryIdAsync("Bakery");
        var created = await (await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("2026-08-01", "Safeway", [new TripItemInput("Bread", categoryId, 3.29m)])))
            .ReadAsAsync<TripDto>();

        var deleteResponse = await _client.DeleteAsync($"/api/v1/profiles/{profileId}/trips/{created!.Id}");
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var getResponse = await _client.GetAsync($"/api/v1/profiles/{profileId}/trips/{created.Id}");
        getResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task DeleteProfile_WithTripsAndItems_CascadesWithoutForeignKeyViolation()
    {
        // Regression test: Store/Item are Profile-owned and themselves cascade from
        // Profile, while TripItems reference both Trip (cascade) and Item — Item must
        // also cascade or this delete throws a FOREIGN KEY constraint failure.
        var profileId = await CreateProfileAsync("Cascade Tester");
        var categoryId = await GetCategoryIdAsync("Frozen");
        await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/trips",
            new TripInput("2026-08-01", "Target", [new TripItemInput("Frozen Pizza", categoryId, 5.49m)]));

        var deleteResponse = await _client.DeleteAsync($"/api/v1/profiles/{profileId}");
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }
}
