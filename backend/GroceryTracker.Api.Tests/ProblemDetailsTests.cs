using System.Net;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

public class ProblemDetailsTests : IDisposable
{
    private readonly GroceryTrackerApiFactory _factory = new();
    private readonly HttpClient _client;

    public ProblemDetailsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task NotFoundTrip_ReturnsProblemDetailsWithStableType()
    {
        var profileId = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("PD Tester")))
            .ReadAsAsync<ProfileDto>())!.Id;

        var response = await _client.GetAsync($"/api/v1/profiles/{profileId}/trips/{Guid.NewGuid()}");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");

        var body = await response.ReadAsAsync<ProblemPayload>();
        body!.Type.Should().Be("/errors/trip-not-found");
    }

    [Fact]
    public async Task DuplicateCategory_ReturnsProblemDetailsWithConflictType()
    {
        await _client.PostJsonAsync("/api/v1/categories", new CreateCategoryRequest("Snacks"));
        var response = await _client.PostJsonAsync("/api/v1/categories", new CreateCategoryRequest("snacks"));

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        var body = await response.ReadAsAsync<ProblemPayload>();
        body!.Type.Should().Be("/errors/category-name-conflict");
    }

    [Fact]
    public async Task BlankProfileName_ReturnsProblemDetailsWithValidationType()
    {
        var response = await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("   "));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.ReadAsAsync<ProblemPayload>();
        body!.Type.Should().Be("/errors/validation");
    }

    private record ProblemPayload(string Type, string Title, int Status, string? Detail);
}
