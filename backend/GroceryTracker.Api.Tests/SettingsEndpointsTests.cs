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

    [Fact]
    public async Task GroupColors_DefaultEmpty_ReplaceWholesale_AndLeaveThemeAlone()
    {
        (await (await _client.GetAsync("/api/v1/settings")).ReadAsAsync<SettingsDto>())!.GroupColors.Should().BeEmpty();

        await _client.PutJsonAsync("/api/v1/settings", new UpdateSettingsRequest("dark"));
        var colors = new Dictionary<string, string> { ["store:aldi"] = "#FDE2C8", ["category:produce"] = "none" };
        var updated = await (await _client.PutJsonAsync("/api/v1/settings", new UpdateSettingsRequest(null, colors))).ReadAsAsync<SettingsDto>();

        updated!.GroupColors.Should().BeEquivalentTo(colors);
        updated.ThemeMode.Should().Be("dark");

        // A theme-only update doesn't touch the colors.
        var themeOnly = await (await _client.PutJsonAsync("/api/v1/settings", new UpdateSettingsRequest("light"))).ReadAsAsync<SettingsDto>();
        themeOnly!.GroupColors.Should().BeEquivalentTo(colors);
    }

    [Theory]
    [InlineData("store:aldi", "red")]
    [InlineData("store:aldi", "#12345")]
    [InlineData("aisle:3", "#123456")]
    [InlineData("store:Aldi Store", "#123456")]
    public async Task GroupColors_Invalid_AreRejected(string key, string value)
    {
        var response = await _client.PutJsonAsync("/api/v1/settings",
            new UpdateSettingsRequest(null, new Dictionary<string, string> { [key] = value }));
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task ChartScheme_DefaultsToFresh_AndPersists()
    {
        var initial = await (await _client.GetAsync("/api/v1/settings")).ReadAsAsync<SettingsDto>();
        initial!.ChartScheme.Should().Be("fresh");

        var updated = await (await _client.PutJsonAsync("/api/v1/settings", new UpdateSettingsRequest(null, null, "berry")))
            .ReadAsAsync<SettingsDto>();
        updated!.ChartScheme.Should().Be("berry");
        updated.ThemeMode.Should().Be("system");

        // Changing something else keeps it.
        await _client.PutJsonAsync("/api/v1/settings", new UpdateSettingsRequest("dark"));
        var after = await (await _client.GetAsync("/api/v1/settings")).ReadAsAsync<SettingsDto>();
        after!.ChartScheme.Should().Be("berry");
    }

    [Fact]
    public async Task ChartScheme_Unknown_IsRejected()
    {
        var response = await _client.PutJsonAsync("/api/v1/settings", new UpdateSettingsRequest(null, null, "neon"));
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
