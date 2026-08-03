using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace GroceryTracker.Core.Data;

// Microsoft.Data.Sqlite does not enable foreign-key enforcement or WAL mode by
// default; both must be set per-connection via PRAGMA.
public class SqlitePragmaInterceptor : DbConnectionInterceptor
{
    private const string Pragmas = "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;";

    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        using var command = connection.CreateCommand();
        command.CommandText = Pragmas;
        command.ExecuteNonQuery();
    }

    public override async Task ConnectionOpenedAsync(
        DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        var command = connection.CreateCommand();
        await using (command.ConfigureAwait(false))
        {
            command.CommandText = Pragmas;
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
