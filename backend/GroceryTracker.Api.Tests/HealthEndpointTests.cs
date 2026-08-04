using System.Net;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

public class HealthEndpointTests : IDisposable
{
    private readonly GroceryTrackerApiFactory _factory = new();
    private readonly HttpClient _client;

    public HealthEndpointTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task GetHealth_ReturnsServiceIdentityAndStableInstanceId()
    {
        var response = await _client.GetAsync("/api/v1/health");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();

        var health = await response.ReadAsAsync<HealthDto>();
        health!.Service.Should().Be("grocery-tracker");
        health.InstanceId.Should().NotBeEmpty();
        health.Status.Should().Be("ok");

        // Offline clients compare this across visits — it must not change
        // between requests to the same running instance.
        var second = await (await _client.GetAsync("/api/v1/health")).ReadAsAsync<HealthDto>();
        second!.InstanceId.Should().Be(health.InstanceId);
    }
}
