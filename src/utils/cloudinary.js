import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";

const cloudName = env.CLOUDINARY_CLOUD_NAME;
const apiKey = env.CLOUDINARY_API_KEY;
const apiSecret = env.CLOUDINARY_API_SECRET;

if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
    });
}

function requireCloudinaryConfigured() {
    if (!cloudName || !apiKey || !apiSecret) {
        throw new Error(
            "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET."
        );
    }
}

export async function uploadImageBuffer(buffer, {
    folder = "justoo/products",
    publicId,
    resourceType = "image",
} = {}) {
    requireCloudinaryConfigured();

    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error("Invalid image buffer");
    }

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                public_id: publicId,
                resource_type: resourceType,
            },
            (err, result) => {
                if (err) return reject(err);
                if (!result?.secure_url) return reject(new Error("Cloudinary upload failed"));
                resolve({
                    url: result.secure_url,
                    publicId: result.public_id,
                });
            }
        );

        stream.end(buffer);
    });
}

export default cloudinary;

