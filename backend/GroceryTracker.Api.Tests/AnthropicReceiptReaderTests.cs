using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using FluentAssertions;
using GroceryTracker.Core.Services;

namespace GroceryTracker.Api.Tests;

// The real reader's request and reply handling, against a fake HTTP endpoint (no network).
public class AnthropicReceiptReaderTests
{
    private sealed class FakeHandler(Func<HttpRequestMessage, string, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public JsonNode? LastBody { get; private set; }
        public HttpRequestMessage? LastRequest { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = await request.Content!.ReadAsStringAsync(ct);
            LastBody = JsonNode.Parse(body);
            LastRequest = request;
            return respond(request, body);
        }
    }

    private static HttpResponseMessage Reply(string tool, string inputJson) => new(HttpStatusCode.OK)
    {
        Content = new StringContent($$"""{"content":[{"type":"tool_use","name":"{{tool}}","input":{{inputJson}}}]}""", Encoding.UTF8, "application/json"),
    };

    private static ReceiptOptions Options(string? key = "test-key") => new() { ApiKey = key, Model = "claude-sonnet-5-5", Endpoint = "https://example.test/v1/messages" };

    [Fact]
    public async Task ReadImage_SendsThePhotoThroughTheTool_AndParsesTheReply()
    {
        var handler = new FakeHandler((_, _) => Reply("record_receipt", """
            {"store":"ALDI","date":"2024-03-15","subtotal":5.5,"tax":0,"total":5.5,
             "lines":[{"text":"Peanut Butter SWC","code":null,"name":"Peanut Butter","quantity":2,"unit":"each","unitPrice":2.75,"amount":5.5,"discount":null,"kind":"item"}]}
            """));
        var reader = new AnthropicReceiptReader(new HttpClient(handler), Options());

        var reading = await reader.ReadImageAsync([1, 2, 3], "image/jpeg", ["Produce", "Dairy"], null, CancellationToken.None);

        reading.Store.Should().Be("ALDI");
        reading.Lines.Should().ContainSingle(l => l.Quantity == 2 && l.UnitPrice == 2.75m && l.Amount == 5.5m);
        handler.LastRequest!.Headers.GetValues("x-api-key").Should().Equal("test-key");
        handler.LastRequest.Headers.GetValues("anthropic-version").Should().Equal("2023-06-01");
        var body = handler.LastBody!;
        body["model"]!.GetValue<string>().Should().Be("claude-sonnet-5-5");
        body["tool_choice"]!["name"]!.GetValue<string>().Should().Be("record_receipt");
        var image = body["messages"]![0]!["content"]![0]!;
        (image["source"]!["media_type"]!.GetValue<string>(), image["source"]!["data"]!.GetValue<string>()).Should().Be(("image/jpeg", "AQID"));
        body["messages"]![0]!["content"]![1]!["text"]!.GetValue<string>().Should().Contain("The household's categories: Produce, Dairy.");
    }

    [Fact]
    public async Task Choose_ReturnsOnlyValidPicks()
    {
        var handler = new FakeHandler((_, _) => Reply("record_choices", """{"choices":[{"line":0,"candidate":1},{"line":1,"candidate":null},{"line":2,"candidate":9}]}"""));
        var reader = new AnthropicReceiptReader(new HttpClient(handler), Options());

        var picks = await reader.ChooseAsync(
            [("REDCD SODIUM BROTH", null, ["Beef Broth", "Reduced Sodium Chicken Broth"]), ("3D KITE", null, ["Kiwi"]), ("X", null, ["A"])],
            CancellationToken.None);

        picks.Should().Equal(1, null, null);
        handler.LastBody!["messages"]![0]!["content"]![0]!["text"]!.GetValue<string>().Should().Contain("Line 0: \"REDCD SODIUM BROTH\"").And.Contain("1: Reduced Sodium Chicken Broth");
    }

    [Fact]
    public async Task Failures_BecomeReadErrors_AndNoKeyMeansNotConfigured()
    {
        var failing = new AnthropicReceiptReader(new HttpClient(new FakeHandler((_, _) => new HttpResponseMessage(HttpStatusCode.TooManyRequests))), Options());
        await failing.Invoking(r => r.ReadTextAsync("x", [], null, CancellationToken.None)).Should().ThrowAsync<ReceiptReadException>().WithMessage("*429*");

        var noTool = new AnthropicReceiptReader(new HttpClient(new FakeHandler((_, _) => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("""{"content":[{"type":"text","text":"hi"}]}""") })), Options());
        await noTool.Invoking(r => r.ReadTextAsync("x", [], null, CancellationToken.None)).Should().ThrowAsync<ReceiptReadException>();

        new AnthropicReceiptReader(new HttpClient(), Options(null)).Configured.Should().BeFalse();
    }
}
