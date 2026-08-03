using System.Net;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Fresh factory (and SQLite file) per test method for full isolation between tests.
public class ListEndpointsTests : IDisposable
{
    private readonly GroceryTrackerApiFactory _factory = new();
    private readonly HttpClient _client;

    public ListEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    private async Task<Guid> CreateProfileAsync() =>
        (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("List Tester")))
            .ReadAsAsync<ProfileDto>())!.Id;

    private async Task<Guid> GetCategoryIdAsync(string name) =>
        (await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>())!
            .First(c => c.Name == name).Id;

    [Fact]
    public async Task CreateList_WithStoresAndItems_RoundTrips()
    {
        var profileId = await CreateProfileAsync();
        var dairyId = await GetCategoryIdAsync("Dairy");

        var input = new GroceryListInput("Weekly stock-up", "2026-08-05",
            ["Costco", "Trader Joe's"],
            [new ListItemInput("Whole Milk", dairyId, "Costco", false)]);

        var response = await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/lists", input);
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var list = await response.ReadAsAsync<GroceryListDto>();

        list!.Stores.Should().BeEquivalentTo(["Costco", "Trader Joe's"]);
        list.Items.Should().ContainSingle(i => i.ItemName == "Whole Milk" && i.PreferredStoreName == "Costco" && !i.Checked);
    }

    [Fact]
    public async Task ToggleListItem_FlipsCheckedState()
    {
        var profileId = await CreateProfileAsync();
        var categoryId = await GetCategoryIdAsync("Produce");
        var list = await (await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/lists",
            new GroceryListInput("List", null, [], [new ListItemInput("Bananas", categoryId, null, false)])))
            .ReadAsAsync<GroceryListDto>();
        var itemId = list!.Items[0].Id;

        var toggleResponse = await _client.PostAsync($"/api/v1/profiles/{profileId}/lists/{list.Id}/items/{itemId}/toggle", null);
        toggleResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var refreshed = await (await _client.GetAsync($"/api/v1/profiles/{profileId}/lists/{list.Id}")).ReadAsAsync<GroceryListDto>();
        refreshed!.Items[0].Checked.Should().BeTrue();
    }

    [Fact]
    public async Task DeleteList_RemovesIt()
    {
        var profileId = await CreateProfileAsync();
        var list = await (await _client.PostJsonAsync($"/api/v1/profiles/{profileId}/lists",
            new GroceryListInput("Throwaway", null, [], [])))
            .ReadAsAsync<GroceryListDto>();

        var deleteResponse = await _client.DeleteAsync($"/api/v1/profiles/{profileId}/lists/{list!.Id}");
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var getResponse = await _client.GetAsync($"/api/v1/profiles/{profileId}/lists/{list.Id}");
        getResponse.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
