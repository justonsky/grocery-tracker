using GroceryTracker.Core.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

// The idempotent PUTs create a row with the client's id when it doesn't exist yet. Two first
// saves of the same id at once (a retried request racing the original) both see "missing", and
// the second insert hits the primary key. Running the upsert again then finds the row and
// updates it, which is what that request meant anyway.
public static class InsertRace
{
    public static async Task<T> RetryOnceAsync<T>(GroceryTrackerDbContext db, Func<Task<T>> upsert)
    {
        try
        {
            return await upsert();
        }
        catch (DbUpdateException e) when (e.InnerException is SqliteException { SqliteErrorCode: 19 })
        {
            db.ChangeTracker.Clear();
            return await upsert();
        }
    }
}
