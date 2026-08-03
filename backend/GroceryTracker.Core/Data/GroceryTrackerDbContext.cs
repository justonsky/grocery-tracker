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
    public DbSet<GroceryList> GroceryLists => Set<GroceryList>();
    public DbSet<ListStore> ListStores => Set<ListStore>();
    public DbSet<ListItem> ListItems => Set<ListItem>();
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
            // Store is Profile-owned and itself cascades from Profile, so this must also
            // cascade rather than Restrict — see the ItemId comment on TripItem below.
            e.HasOne(t => t.Store).WithMany()
                .HasForeignKey(t => t.StoreId).OnDelete(DeleteBehavior.Cascade);
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
        });

        modelBuilder.Entity<GroceryList>(e =>
        {
            e.HasKey(l => l.Id);
            e.Property(l => l.Id).ValueGeneratedNever();
            e.HasIndex(l => l.ProfileId);
            e.HasOne(l => l.Profile).WithMany(p => p.Lists)
                .HasForeignKey(l => l.ProfileId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ListStore>(e =>
        {
            e.HasKey(ls => ls.Id);
            e.Property(ls => ls.Id).ValueGeneratedNever();
            e.HasIndex(ls => ls.ListId);
            e.HasOne(ls => ls.List).WithMany(l => l.Stores)
                .HasForeignKey(ls => ls.ListId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ListItem>(e =>
        {
            e.HasKey(li => li.Id);
            e.Property(li => li.Id).ValueGeneratedNever();
            e.HasIndex(li => li.ListId);
            e.HasOne(li => li.List).WithMany(l => l.Items)
                .HasForeignKey(li => li.ListId).OnDelete(DeleteBehavior.Cascade);
            // Same cascade-vs-restrict reasoning as TripItem.ItemId above.
            e.HasOne(li => li.Item).WithMany()
                .HasForeignKey(li => li.ItemId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(li => li.Category).WithMany()
                .HasForeignKey(li => li.CategoryId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(li => li.PreferredStore).WithMany()
                .HasForeignKey(li => li.PreferredStoreId).OnDelete(DeleteBehavior.SetNull);
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
