namespace GroceryTracker.Api;

// Stable `type` URIs for ProblemDetails responses. The offline-sync client
// classifies failures (retry / drop / auto-heal) by this string, not by bare
// HTTP status codes, so these values are a contract — don't rename casually.
public static class ProblemTypes
{
    public const string ProfileNotFound = "/errors/profile-not-found";
    public const string TripNotFound = "/errors/trip-not-found";
    public const string ListNotFound = "/errors/list-not-found";
    public const string ItemNotFound = "/errors/item-not-found";
    public const string CategoryNotFound = "/errors/category-not-found";
    public const string CategoryNameConflict = "/errors/category-name-conflict";
    public const string CategoryBuiltIn = "/errors/category-built-in";
    public const string CrossProfile = "/errors/cross-profile";
    public const string Validation = "/errors/validation";
    public const string DbUpdate = "/errors/db-update";
    public const string Unexpected = "/errors/unexpected";
}
