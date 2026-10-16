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
    public DbSet<TrackedItem> TrackedItems => Set<TrackedItem>();
    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<RecipeItem> RecipeItems => Set<RecipeItem>();
    public DbSet<TripRecipe> TripRecipes => Set<TripRecipe>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Profile>(e =>
        {
            e.HasKey(p => p.Id);
            e.Property(p => p.Id).ValueGeneratedNever();
            e.Property(p => p.Theme).HasMaxLength(32).HasDefaultValue(Profile.DefaultTheme);
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
            e.HasIndex(s => s.NormalizedName).IsUnique();
        });

        modelBuilder.Entity<Item>(e =>
        {
            e.HasKey(i => i.Id);
            e.Property(i => i.Id).ValueGeneratedNever();
            e.HasIndex(i => i.NormalizedName).IsUnique();
            e.HasOne(i => i.DefaultCategory).WithMany()
                .HasForeignKey(i => i.DefaultCategoryId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Trip>(e =>
        {
            e.HasKey(t => t.Id);
            e.Property(t => t.Id).ValueGeneratedNever();
            e.HasIndex(t => new { t.ProfileId, t.Date });
            // Stored as text ("Planned"/"Shopping"/"Done") so the .db file stays
            // readable and reordering the enum can never reinterpret old rows.
            e.Property(t => t.Status).HasConversion<string>().HasMaxLength(16);
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
            // Deleting an item (Items portal) deliberately cascades to every trip line
            // using it — ItemCatalogService.DeleteAsync relies on this. Keep Cascade.
            // Deleting a profile removes its trips, never items.
            e.HasOne(ti => ti.Item).WithMany()
                .HasForeignKey(ti => ti.ItemId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(ti => ti.Category).WithMany()
                .HasForeignKey(ti => ti.CategoryId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(ti => ti.Store).WithMany()
                .HasForeignKey(ti => ti.StoreId).OnDelete(DeleteBehavior.SetNull);
        });


        modelBuilder.Entity<TrackedItem>(e =>
        {
            e.HasKey(ti => new { ti.ProfileId, ti.ItemId });
            e.HasOne(ti => ti.Profile).WithMany(p => p.TrackedItems)
                .HasForeignKey(ti => ti.ProfileId).OnDelete(DeleteBehavior.Cascade);
            // Deleting an item (Items portal) or merging it away unpins it everywhere.
            e.HasOne(ti => ti.Item).WithMany()
                .HasForeignKey(ti => ti.ItemId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Recipe>(e =>
        {
            e.HasKey(r => r.Id);
            e.Property(r => r.Id).ValueGeneratedNever();
            e.Property(r => r.Name).HasMaxLength(RecipeLimits.NameLength);
            e.Property(r => r.Description).HasMaxLength(RecipeLimits.DescriptionLength);
            e.Property(r => r.PhotoContentType).HasMaxLength(32);
        });

        modelBuilder.Entity<RecipeItem>(e =>
        {
            e.HasKey(ri => ri.Id);
            e.Property(ri => ri.Id).ValueGeneratedNever();
            e.Property(ri => ri.Amount).HasMaxLength(RecipeLimits.AmountLength);
            e.HasIndex(ri => ri.RecipeId);
            e.HasOne(ri => ri.Recipe).WithMany(r => r.Items)
                .HasForeignKey(ri => ri.RecipeId).OnDelete(DeleteBehavior.Cascade);
            // Deleting an item (Items portal) drops it from recipes, as it does from trips.
            e.HasOne(ri => ri.Item).WithMany()
                .HasForeignKey(ri => ri.ItemId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TripRecipe>(e =>
        {
            e.HasKey(tr => new { tr.TripId, tr.RecipeId });
            e.HasIndex(tr => tr.RecipeId);
            e.HasOne(tr => tr.Trip).WithMany(t => t.Recipes)
                .HasForeignKey(tr => tr.TripId).OnDelete(DeleteBehavior.Cascade);
            // Deleting a recipe takes it off trips' planned meals; their item lines stay.
            e.HasOne(tr => tr.Recipe).WithMany()
                .HasForeignKey(tr => tr.RecipeId).OnDelete(DeleteBehavior.Cascade);
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
