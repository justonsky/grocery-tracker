using System.Net;
using FluentAssertions;
using GroceryTracker.Core.Dtos;

namespace GroceryTracker.Api.Tests;

// Fresh factory (and SQLite file) per test method — settings are a shared, mutable
// singleton row, so a factory reused across test methods (IClassFixture) would leak
// state between them.
public class SettingsEndpointsTests : IDisposable
{
    private readonly GroceryTrackerApiFactory _factory = new();
    private readonly HttpClient _client;

    public SettingsEndpointsTests() => _client = _factory.CreateClient();

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task GetSettings_DefaultsToSystemTheme()
    {
        var settings = await (await _client.GetAsync("/api/v1/settings")).ReadAsAsync<SettingsDto>();
        settings!.ThemeMode.Should().Be("system");
    }

    [Fact]
    public async Task UpdateSettings_PersistsTheme()
    {
        var updateResponse = await _client.PutJsonAsync("/api/v1/settings", new UpdateSettingsRequest("dark"));
        updateResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var updated = await updateResponse.ReadAsAsync<SettingsDto>();
        updated!.ThemeMode.Should().Be("dark");

        var refetched = await (await _client.GetAsync("/api/v1/settings")).ReadAsAsync<SettingsDto>();
        refetched!.ThemeMode.Should().Be("dark");
    }
}
