using System.Net;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Covers the idempotent-upsert PUT routes added for the offline-sync outbox:
// client-generated ids, safe replay, cross-profile protection, and the
// delete-then-recreate path a profile's own PUT enables.
public class UpsertEndpointsTests : IDisposable
{
    private readonly GroceryTrackerApiFactory _factory = new();
    private readonly HttpClient _client;

    public UpsertEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private async Task<Guid> CreateProfileAsync(string name = "Upsert Tester") =>
        (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest(name)))
            .ReadAsAsync<ProfileDto>())!.Id;

    private async Task<Guid> GetCategoryIdAsync(string name) =>
        (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!
            .First(c => c.Name == name).Id;

    [Fact]
    public async Task PutTrip_WithClientGeneratedId_CreatesAtThatId()
    {
        var profileId = await CreateProfileAsync();
        var categoryId = await GetCategoryIdAsync("Dairy");
        var tripId = Guid.NewGuid();

        var response = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{tripId}",
            new TripInput("2026-08-01", "Aldi", [new TripItemInput("Milk", categoryId, 3.49m)]));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var trip = await response.ReadAsAsync<TripDto>();
        trip!.Id.Should().Be(tripId);
    }

    [Fact]
    public async Task PutTrip_ReplayedIdentically_ReturnsOkWithoutDuplicating()
    {
        var profileId = await CreateProfileAsync();
        var categoryId = await GetCategoryIdAsync("Dairy");
        var tripId = Guid.NewGuid();
        var input = new TripInput("2026-08-01", "Aldi", [new TripItemInput("Milk", categoryId, 3.49m)]);

        var first = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{tripId}", input);
        first.StatusCode.Should().Be(HttpStatusCode.Created);

        var second = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{tripId}", input);
        second.StatusCode.Should().Be(HttpStatusCode.OK);

        var all = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/trips")).ReadAsAsync<List<TripSummaryDto>>();
        all.Should().ContainSingle(t => t.Id == tripId);
    }

    [Fact]
    public async Task PutTrip_ReplayedWithChangedPayload_Replaces()
    {
        var profileId = await CreateProfileAsync();
        var categoryId = await GetCategoryIdAsync("Dairy");
        var tripId = Guid.NewGuid();

        await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{tripId}",
            new TripInput("2026-08-01", "Aldi", [new TripItemInput("Milk", categoryId, 3.49m)]));

        var updateResponse = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{tripId}",
            new TripInput("2026-08-02", "Aldi", [new TripItemInput("Eggs", categoryId, 4.29m)]));

        updateResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var trip = await updateResponse.ReadAsAsync<TripDto>();
        trip!.Date.Should().Be("2026-08-02");
        trip.Items.Should().ContainSingle(i => i.ItemName == "Eggs");
    }

    [Fact]
    public async Task PutTrip_BelongingToDifferentProfile_ReturnsConflictAndDoesNotMutate()
    {
        var profileA = await CreateProfileAsync("A");
        var profileB = await CreateProfileAsync("B");
        var categoryId = await GetCategoryIdAsync("Dairy");
        var tripId = Guid.NewGuid();

        await _client.PutJsonAsync($"/api/v1/profiles/{profileA}/trips/{tripId}",
            new TripInput("2026-08-01", "Aldi", [new TripItemInput("Milk", categoryId, 3.49m)]));

        var hijackAttempt = await _client.PutJsonAsync($"/api/v1/profiles/{profileB}/trips/{tripId}",
            new TripInput("2026-08-05", "Costco", [new TripItemInput("Eggs", categoryId, 5.99m)]));

        hijackAttempt.StatusCode.Should().Be(HttpStatusCode.Conflict);

        var stillOwnedByA = await (await _client.GetAsync($"/api/v1/profiles/{profileA}/trips/{tripId}")).ReadAsAsync<TripDto>();
        stillOwnedByA!.StoreName.Should().Be("Aldi");
    }

    [Fact]
    public async Task PutTrip_EmptyGuid_ReturnsBadRequest()
    {
        var profileId = await CreateProfileAsync();
        var categoryId = await GetCategoryIdAsync("Dairy");

        var response = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/trips/{Guid.Empty}",
            new TripInput("2026-08-01", "Aldi", [new TripItemInput("Milk", categoryId, 3.49m)]));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task PutList_WithClientGeneratedId_CreatesAtThatId()
    {
        var profileId = await CreateProfileAsync();
        var categoryId = await GetCategoryIdAsync("Produce");
        var listId = Guid.NewGuid();

        var response = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}/lists/{listId}",
            new GroceryListInput("Weekly", null, [], [new ListItemInput("Bananas", categoryId, null, false)]));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var list = await response.ReadAsAsync<GroceryListDto>();
        list!.Id.Should().Be(listId);
    }

    [Fact]
    public async Task PutProfile_AfterDelete_Recreates()
    {
        var profileId = await CreateProfileAsync("Recreate Me");
        (await _client.DeleteAsync($"/api/v1/profiles/{profileId}")).StatusCode.Should().Be(HttpStatusCode.NoContent);

        var response = await _client.PutJsonAsync($"/api/v1/profiles/{profileId}", new CreateProfileRequest("Recreate Me"));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var profiles = await (await _client.GetAsync("/api/v1/profiles")).ReadAsAsync<List<ProfileDto>>();
        profiles.Should().ContainSingle(p => p.Id == profileId);
    }

    [Fact]
    public async Task PutCategory_WithClientGeneratedId_CreatesAtThatId()
    {
        var categoryId = Guid.NewGuid();
        var response = await _client.PutJsonAsync($"/api/v1/categories/{categoryId}", new CreateCategoryRequest("Snacks"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var category = await response.ReadAsAsync<CategoryDto>();
        category!.Id.Should().Be(categoryId);
        category.IsBuiltIn.Should().BeFalse();
    }

    [Fact]
    public async Task PutCategory_NameTakenByAnotherId_ReturnsConflict()
    {
        var existing = await (await _client.PostJsonAsync("/api/v1/categories", new CreateCategoryRequest("Snacks")))
            .ReadAsAsync<CategoryDto>();

        var response = await _client.PutJsonAsync($"/api/v1/categories/{Guid.NewGuid()}", new CreateCategoryRequest("snacks"));

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        existing!.Name.Should().Be("Snacks"); // unaffected
    }

    [Fact]
    public async Task PutCategory_TargetingBuiltInId_ReturnsBadRequestAndDoesNotRename()
    {
        var produceId = await GetCategoryIdAsync("Produce");

        var response = await _client.PutJsonAsync($"/api/v1/categories/{produceId}", new CreateCategoryRequest("Not Produce"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var categories = await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>();
        categories.Should().ContainSingle(c => c.Id == produceId && c.Name == "Produce");
    }
}
