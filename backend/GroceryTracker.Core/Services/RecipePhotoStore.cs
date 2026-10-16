using GroceryTracker.Core.Entities;

namespace GroceryTracker.Core.Services;

public enum PhotoCheck { Ok, NotAnImage, TooManyBytes, TooBig }

// Recipe photos are plain files in the data folder (recipe-photos/<id>), so they are
// covered by backing up that folder and never bloat the SQLite file. Uploads are
// checked, not re-encoded: the in-app crop editor already shrinks and crops, and a
// photo over the limits is refused so the user crops it instead of losing quality silently.
public class RecipePhotoStore(string dataDirectory)
{
    private string Dir => Path.Combine(dataDirectory, "recipe-photos");
    private string PathFor(Guid recipeId) => Path.Combine(Dir, recipeId.ToString("N"));

    public static PhotoCheck Check(byte[] bytes, out string? contentType, out int width, out int height)
    {
        width = height = 0;
        contentType = null;
        if (!ImageHeader.TryRead(bytes, out contentType, out width, out height)) return PhotoCheck.NotAnImage;
        if (bytes.Length > RecipeLimits.PhotoMaxBytes) return PhotoCheck.TooManyBytes;
        if (width > RecipeLimits.PhotoMaxWidth || height > RecipeLimits.PhotoMaxHeight) return PhotoCheck.TooBig;
        return PhotoCheck.Ok;
    }

    public async Task SaveAsync(Guid recipeId, byte[] bytes, CancellationToken ct)
    {
        Directory.CreateDirectory(Dir);
        var temp = PathFor(recipeId) + ".tmp";
        await File.WriteAllBytesAsync(temp, bytes, ct);
        File.Move(temp, PathFor(recipeId), overwrite: true);
    }

    public Stream? Open(Guid recipeId) => File.Exists(PathFor(recipeId)) ? File.OpenRead(PathFor(recipeId)) : null;

    public void Delete(Guid recipeId)
    {
        var path = PathFor(recipeId);
        if (File.Exists(path)) File.Delete(path);
    }
}

// Reads just enough of a JPEG, PNG or WebP header to know its type and size.
public static class ImageHeader
{
    public static bool TryRead(byte[] b, out string? contentType, out int width, out int height)
    {
        contentType = null;
        width = height = 0;
        if (b.Length > 24 && b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G')
        {
            contentType = "image/png";
            width = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
            height = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
            return width > 0 && height > 0;
        }
        if (b.Length > 4 && b[0] == 0xFF && b[1] == 0xD8)
        {
            contentType = "image/jpeg";
            var i = 2;
            while (i + 9 < b.Length)
            {
                if (b[i] != 0xFF) { i++; continue; }
                var marker = b[i + 1];
                if (marker == 0xFF) { i++; continue; }
                if (marker is 0xD8 or 0x01 || marker is >= 0xD0 and <= 0xD7) { i += 2; continue; }
                var length = (b[i + 2] << 8) | b[i + 3];
                // Start-of-frame markers carry the size (C4, C8 and CC are not frames).
                if (marker is >= 0xC0 and <= 0xCF && marker is not (0xC4 or 0xC8 or 0xCC))
                {
                    height = (b[i + 5] << 8) | b[i + 6];
                    width = (b[i + 7] << 8) | b[i + 8];
                    return width > 0 && height > 0;
                }
                i += 2 + length;
            }
            return false;
        }
        if (b.Length > 30 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P')
        {
            contentType = "image/webp";
            if (b[12] == 'V' && b[13] == 'P' && b[14] == '8' && b[15] == ' ')
            {
                width = (b[26] | (b[27] << 8)) & 0x3FFF;
                height = (b[28] | (b[29] << 8)) & 0x3FFF;
            }
            else if (b[12] == 'V' && b[13] == 'P' && b[14] == '8' && b[15] == 'L')
            {
                var bits = b[21] | (b[22] << 8) | (b[23] << 16) | ((uint)b[24] << 24);
                width = (int)(bits & 0x3FFF) + 1;
                height = (int)((bits >> 14) & 0x3FFF) + 1;
            }
            else if (b[12] == 'V' && b[13] == 'P' && b[14] == '8' && b[15] == 'X')
            {
                width = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
                height = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
            }
            return width > 0 && height > 0;
        }
        return false;
    }
}
