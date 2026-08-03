using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace GroceryTracker.Core.Data;

// Used only by `dotnet ef migrations add` at design time — the running app
// configures the real DbContext (and data directory) itself in Program.cs.
public class GroceryTrackerDbContextFactory : IDesignTimeDbContextFactory<GroceryTrackerDbContext>
{
    public GroceryTrackerDbContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<GroceryTrackerDbContext>();
        optionsBuilder.UseSqlite("Data Source=grocerytracker.design.db");
        return new GroceryTrackerDbContext(optionsBuilder.Options);
    }
}
