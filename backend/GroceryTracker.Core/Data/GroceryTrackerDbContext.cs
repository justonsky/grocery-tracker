using GroceryTracker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace GroceryTracker.Core.Data;

public class GroceryTrackerDbContext(DbContextOptions<GroceryTrackerDbContext> options) : DbContext(options)
{
    public DbSet<Profile> Profiles => Set<Profile>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Store> Stores => Set<Store>();
    public DbSet<Item> Items => Set<Item>();
    public DbSet<Trip> Trips => Set<Trip>();
    public DbSet<TripItem> TripItems => Set<TripItem>();
    public DbSet<TripStore> TripStores => Set<TripStore>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Profile>(e =>
        {
            e.HasKey(p => p.Id);
            e.Property(p => p.Id).ValueGeneratedNever();
        });

        modelBuilder.Entity<Category>(e =>
        {
            e.HasKey(c => c.Id);
            e.Property(c => c.Id).ValueGeneratedNever();
            e.HasIndex(c => c.NormalizedName).IsUnique();
        });

        modelBuilder.Entity<Store>(e =>
        {
            e.HasKey(s => s.Id);
            e.Property(s => s.Id).ValueGeneratedNever();
            e.HasIndex(s => new { s.ProfileId, s.NormalizedName }).IsUnique();
            e.HasOne(s => s.Profile).WithMany(p => p.Stores)
                .HasForeignKey(s => s.ProfileId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Item>(e =>
        {
            e.HasKey(i => i.Id);
            e.Property(i => i.Id).ValueGeneratedNever();
            e.HasIndex(i => new { i.ProfileId, i.NormalizedName }).IsUnique();
            e.HasOne(i => i.Profile).WithMany(p => p.Items)
                .HasForeignKey(i => i.ProfileId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(i => i.DefaultCategory).WithMany()
                .HasForeignKey(i => i.DefaultCategoryId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Trip>(e =>
        {
            e.HasKey(t => t.Id);
            e.Property(t => t.Id).ValueGeneratedNever();
            e.HasIndex(t => new { t.ProfileId, t.Date });
            e.HasOne(t => t.Profile).WithMany(p => p.Trips)
                .HasForeignKey(t => t.ProfileId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TripStore>(e =>
        {
            e.HasKey(ts => ts.Id);
            e.Property(ts => ts.Id).ValueGeneratedNever();
            e.HasIndex(ts => ts.TripId);
            e.HasOne(ts => ts.Trip).WithMany(t => t.Stores)
                .HasForeignKey(ts => ts.TripId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TripItem>(e =>
        {
            e.HasKey(ti => ti.Id);
            e.Property(ti => ti.Id).ValueGeneratedNever();
            e.HasIndex(ti => ti.ItemId); // powers item price-history queries
            e.HasOne(ti => ti.Trip).WithMany(t => t.Items)
                .HasForeignKey(ti => ti.TripId).OnDelete(DeleteBehavior.Cascade);
            // Item is Profile-owned and itself cascades from Profile. Deleting a profile
            // cascades to both Items and Trips/TripItems in the same statement; SQLite
            // checks RESTRICT immediately (not deferred to statement end), so Restrict
            // here would risk a transient FK violation depending on cascade processing
            // order. Cascade instead — nothing ever deletes an Item independently anyway.
            e.HasOne(ti => ti.Item).WithMany()
                .HasForeignKey(ti => ti.ItemId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(ti => ti.Category).WithMany()
                .HasForeignKey(ti => ti.CategoryId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(ti => ti.Store).WithMany()
                .HasForeignKey(ti => ti.StoreId).OnDelete(DeleteBehavior.SetNull);
        });


        modelBuilder.Entity<AppSetting>(e =>
        {
            e.HasKey(s => s.Key);
        });

        SeedBuiltInCategories(modelBuilder);
    }

    private static void SeedBuiltInCategories(ModelBuilder modelBuilder)
    {
        string[] names =
        [
            "Produce", "Dairy", "Meat & Seafood", "Bakery", "Pantry",
            "Frozen", "Beverages", "Household", "Other",
        ];

        var categories = names.Select((name, index) => new Category
        {
            // Fixed, deterministic GUIDs so re-running the seed migration is idempotent
            // across environments rather than generating a new Id every time.
            Id = Guid.Parse($"00000000-0000-0000-0000-{index + 1:D12}"),
            Name = name,
            NormalizedName = name.Trim().ToLowerInvariant(),
            IsBuiltIn = true,
            SortOrder = index,
        });

        modelBuilder.Entity<Category>().HasData(categories);
    }
}
