using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GroceryTracker.Core.Migrations
{
    /// <inheritdoc />
    public partial class AddReceipts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ItemAliases",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    StoreId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Key = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Label = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    ItemId = table.Column<Guid>(type: "TEXT", nullable: false),
                    TimesUsed = table.Column<int>(type: "INTEGER", nullable: false),
                    LastUsedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ItemAliases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ItemAliases_Items_ItemId",
                        column: x => x.ItemId,
                        principalTable: "Items",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ItemAliases_Stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "Stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Receipts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
                    StoreRead = table.Column<string>(type: "TEXT", maxLength: 120, nullable: true),
                    StoreName = table.Column<string>(type: "TEXT", maxLength: 120, nullable: true),
                    Date = table.Column<string>(type: "TEXT", maxLength: 10, nullable: true),
                    SubtotalCents = table.Column<int>(type: "INTEGER", nullable: true),
                    TaxCents = table.Column<int>(type: "INTEGER", nullable: false),
                    TotalCents = table.Column<int>(type: "INTEGER", nullable: true),
                    HasImage = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    AppliedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Receipts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ReceiptLines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ReceiptId = table.Column<Guid>(type: "TEXT", nullable: false),
                    SortOrder = table.Column<int>(type: "INTEGER", nullable: false),
                    Text = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Code = table.Column<string>(type: "TEXT", maxLength: 40, nullable: true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 120, nullable: true),
                    QuantityMilli = table.Column<int>(type: "INTEGER", nullable: false),
                    Unit = table.Column<string>(type: "TEXT", maxLength: 8, nullable: false),
                    UnitPriceCents = table.Column<int>(type: "INTEGER", nullable: true),
                    PriceCents = table.Column<int>(type: "INTEGER", nullable: false),
                    DiscountCents = table.Column<int>(type: "INTEGER", nullable: false),
                    Kind = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
                    Category = table.Column<string>(type: "TEXT", maxLength: 60, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReceiptLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ReceiptLines_Receipts_ReceiptId",
                        column: x => x.ReceiptId,
                        principalTable: "Receipts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ItemAliases_ItemId",
                table: "ItemAliases",
                column: "ItemId");

            migrationBuilder.CreateIndex(
                name: "IX_ItemAliases_StoreId_Key",
                table: "ItemAliases",
                columns: new[] { "StoreId", "Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReceiptLines_ReceiptId",
                table: "ReceiptLines",
                column: "ReceiptId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ItemAliases");

            migrationBuilder.DropTable(
                name: "ReceiptLines");

            migrationBuilder.DropTable(
                name: "Receipts");
        }
    }
}
