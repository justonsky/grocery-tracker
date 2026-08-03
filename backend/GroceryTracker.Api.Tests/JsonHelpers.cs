using System.Net.Http.Json;
using System.Text.Json;

namespace GroceryTracker.Api.Tests;

public static class JsonHelpers
{
    public static readonly JsonSerializerOptions Options = new() { PropertyNameCaseInsensitive = true };

    public static Task<HttpResponseMessage> PostJsonAsync<T>(this HttpClient client, string url, T body) =>
        client.PostAsJsonAsync(url, body, Options);

    public static Task<HttpResponseMessage> PutJsonAsync<T>(this HttpClient client, string url, T body) =>
        client.PutAsJsonAsync(url, body, Options);

    public static Task<T?> ReadAsAsync<T>(this HttpResponseMessage response) =>
        response.Content.ReadFromJsonAsync<T>(Options);
}
