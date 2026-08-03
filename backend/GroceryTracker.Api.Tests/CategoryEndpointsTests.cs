using System.Net;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Fresh factory (and SQLite file) per test method — several tests assert the exact
// built-in category count, so state must not leak between test methods.
public class CategoryEndpointsTests : IDisposable
{
    private readonly GroceryTrackerApiFactory _factory = new();
    private readonly HttpClient _client;

    public CategoryEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task List_ReturnsNineBuiltInCategories()
    {
        var categories = await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>();
        categories.Should().HaveCount(9);
        categories.Should().OnlyContain(c => c.IsBuiltIn);
        categories.Select(c => c.Name).Should().Contain(["Produce", "Other"]);
    }

    [Fact]
    public async Task CreateCategory_ThenDelete_Succeeds()
    {
        var createResponse = await _client.PostJsonAsync("/api/v1/categories", new CreateCategoryRequest("Snacks"));
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await createResponse.ReadAsAsync<CategoryDto>();
        created!.IsBuiltIn.Should().BeFalse();

        var deleteResponse = await _client.DeleteAsync($"/api/v1/categories/{created.Id}");
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task CreateCategory_DuplicateNameCaseInsensitive_ReturnsConflict()
    {
        await _client.PostJsonAsync("/api/v1/categories", new CreateCategoryRequest("Duplicates"));
        var second = await _client.PostJsonAsync("/api/v1/categories", new CreateCategoryRequest("duplicates"));
        second.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task DeleteBuiltInCategory_ReturnsBadRequest()
    {
        var categories = await (await _client.GetAsync("/api/v1/categories")).ReadAsAsync<List<CategoryDto>>();
        var produce = categories!.First(c => c.Name == "Produce");

        var response = await _client.DeleteAsync($"/api/v1/categories/{produce.Id}");
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task DeleteMissingCategory_ReturnsNotFound()
    {
        var response = await _client.DeleteAsync($"/api/v1/categories/{Guid.NewGuid()}");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
