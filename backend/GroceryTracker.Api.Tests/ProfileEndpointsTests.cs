using System.Net;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Fresh factory (and SQLite file) per test method for full isolation between tests.
public class ProfileEndpointsTests : IDisposable
{
    private readonly GroceryTrackerApiFactory _factory = new();
    private readonly HttpClient _client;

    public ProfileEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task CreateAndListProfile_RoundTrips()
    {
        var createResponse = await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("Alex"));
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await createResponse.ReadAsAsync<ProfileDto>();
        created.Should().NotBeNull();
        created!.Name.Should().Be("Alex");
        created.TripCount.Should().Be(0);

        var listResponse = await _client.GetAsync("/api/v1/profiles");
        var profiles = await listResponse.ReadAsAsync<List<ProfileDto>>();
        profiles.Should().Contain(p => p.Id == created.Id && p.Name == "Alex");
    }

    [Fact]
    public async Task DeleteProfile_RemovesIt()
    {
        var created = (await (await _client.PostJsonAsync("/api/v1/profiles", new CreateProfileRequest("ToDelete")))
            .ReadAsAsync<ProfileDto>())!;

        var deleteResponse = await _client.DeleteAsync($"/api/v1/profiles/{created.Id}");
        deleteResponse.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var profiles = await (await _client.GetAsync("/api/v1/profiles")).ReadAsAsync<List<ProfileDto>>();
        profiles.Should().NotContain(p => p.Id == created.Id);
    }

    [Fact]
    public async Task DeleteProfile_WhenMissing_ReturnsNotFound()
    {
        var response = await _client.DeleteAsync($"/api/v1/profiles/{Guid.NewGuid()}");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
