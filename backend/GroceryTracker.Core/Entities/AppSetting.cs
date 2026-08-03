namespace GroceryTracker.Core.Entities;

// Device-local key/value state (theme mode, last-selected profile), not user "data".
public class AppSetting
{
    public required string Key { get; set; }
    public required string Value { get; set; }
}
