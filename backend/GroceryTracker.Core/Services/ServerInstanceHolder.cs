namespace GroceryTracker.Core.Services;

// Mutable singleton populated once at startup (see Program.cs) so /health can
// answer without a DB round-trip on every request. The value itself is a
// stable per-install identifier — see ServerInstanceService.
public class ServerInstanceHolder
{
    public Guid InstanceId { get; set; }
}
