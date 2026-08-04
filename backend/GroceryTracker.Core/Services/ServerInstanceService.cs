using GroceryTracker.Core.Data;
using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Services;

// A stable identifier for this particular server install, persisted in the
// AppSettings KV table. Offline clients compare it against /health before
// trusting a reachable address enough to sync writes to it — home-LAN private
// addresses (192.168.x.x) are commonly reused across networks, so "something
// answered on port 5080" is not proof it's *your* server.
public class ServerInstanceService(GroceryTrackerDbContext db)
{
    private const string InstanceIdKey = "InstanceId";

    public async Task<Guid> EnsureInstanceIdAsync(CancellationToken ct = default)
    {
        var existing = await db.AppSettings.FindAsync([InstanceIdKey], ct);
        if (existing is not null && Guid.TryParse(existing.Value, out var id))
        {
            return id;
        }

        var newId = Guid.NewGuid();
        if (existing is null)
        {
            db.AppSettings.Add(new AppSetting { Key = InstanceIdKey, Value = newId.ToString() });
        }
        else
        {
            existing.Value = newId.ToString();
        }
        await db.SaveChangesAsync(ct);
        return newId;
    }
}
