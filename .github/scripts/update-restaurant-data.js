const fs = require('fs');
const path = require('path');

// TikTok thumbnail fetching function
async function fetchTikTokThumbnail(url) {
    if (!url || !url.includes('tiktok.com')) return null;
    
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
        
        if (!response.ok) {
            console.log(`⚠️ TikTok thumbnail fetch failed for ${url}: ${response.status}`);
            return null;
        }
        
        const json = await response.json();
        return json.thumbnail_url || null;
    } catch (error) {
        console.log(`⚠️ Error fetching TikTok thumbnail for ${url}:`, error.message);
        return null;
    }
}

// Download and save thumbnail to local file
async function downloadAndSaveThumbnail(thumbnailUrl, localPath) {
    try {
        const fetch = (await import('node-fetch')).default;
        const sharp = require('sharp');
        const response = await fetch(thumbnailUrl);
        
        if (!response.ok) {
            console.log(`⚠️ Thumbnail download failed: ${response.status}`);
            return false;
        }
        
        // Ensure thumbnails directory exists
        const thumbnailsDir = path.join(process.cwd(), 'thumbnails');
        if (!fs.existsSync(thumbnailsDir)) {
            fs.mkdirSync(thumbnailsDir, { recursive: true });
        }
        
        // Download and compress the image
        const buffer = await response.buffer();
        const compressedBuffer = await sharp(buffer)
            .jpeg({ 
                quality: 80, 
                progressive: true 
            })
            .resize({ width: 300, withoutEnlargement: true })
            .toBuffer();
        
        const fullPath = path.join(process.cwd(), localPath);
        fs.writeFileSync(fullPath, compressedBuffer);
        
        console.log(`✅ Downloaded and compressed thumbnail to ${localPath}`);
        return true;
    } catch (error) {
        console.log(`⚠️ Error downloading thumbnail:`, error.message);
        return false;
    }
}

// Geocoding function
async function geocodeAddress(address, apiKey) {
    if (!address || address === '') return null;
    
    try {
        const fetch = (await import('node-fetch')).default;
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
        
        const response = await fetch(url);
        if (!response.ok) {
            console.log(`⚠️ Geocoding failed for ${address}: ${response.status}`);
            return null;
        }
        
        const json = await response.json();
        
        if (json.status === 'OK' && json.results.length > 0) {
            const location = json.results[0].geometry.location;
            return `${location.lat}, ${location.lng}`;
        } else {
            console.log(`⚠️ Address not found: ${address} (status: ${json.status})`);
            return null;
        }
    } catch (error) {
        console.log(`⚠️ Error geocoding address ${address}:`, error.message);
        return null;
    }
}

// Fetch CSV with retry logic
async function fetchCSVWithRetry(url, maxRetries = 5) {
    const fetch = (await import('node-fetch')).default;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`📊 Fetching CSV (attempt ${attempt}/${maxRetries})...`);
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const csvText = await response.text();
            
            // Check for Google Sheets formula errors
            const errorCount = (csvText.match(/#NAME\?|#ERROR!|#REF!|#VALUE!/g) || []).length;
            
            if (errorCount === 0) {
                console.log(`✅ CSV fetch successful on attempt ${attempt}`);
                return csvText;
            } else {
                console.log(`⚠️ CSV contains ${errorCount} formula errors on attempt ${attempt}`);
                if (attempt === maxRetries) {
                    console.log(`❌ Max retries reached, proceeding with ${errorCount} errors`);
                    return csvText;
                }
                
                // Wait before retry (10 seconds * attempt number)
                const waitTime = 10000 * attempt;
                console.log(`⏱️ Waiting ${waitTime/1000} seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        } catch (error) {
            console.log(`❌ CSV fetch failed on attempt ${attempt}:`, error.message);
            if (attempt === maxRetries) throw error;
            
            // Wait before retry (10 seconds * attempt number)
            const waitTime = 10000 * attempt;
            console.log(`⏱️ Waiting ${waitTime/1000} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// Parse CSV data
function parseCSV(csvText) {
    const lines = [];
    let currentLine = '';
    let inQuotes = false;
    
    // First, properly split lines while handling multiline quoted fields
    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
            currentLine += char;
        } else if (char === '\n' && !inQuotes) {
            if (currentLine.trim()) {
                lines.push(currentLine.trim());
            }
            currentLine = '';
        } else {
            currentLine += char;
        }
    }
    
    // Add the last line if there's content
    if (currentLine.trim()) {
        lines.push(currentLine.trim());
    }
    
    if (lines.length < 2) {
        return [];
    }
    
    const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/"/g, ''));
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row = {};
        
        headers.forEach((header, index) => {
            let value = values[index] ? values[index].trim().replace(/"/g, '') : '';
            // Replace any embedded newlines with spaces
            value = value.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
            row[header] = value;
        });
        
        data.push(row);
    }
    
    return data;
}

// Parse a single CSV line (handles commas within quotes)
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current);
    return result;
}

// Validate coordinates
function validateCoordinates(geocodeScript) {
    if (!geocodeScript || geocodeScript.includes('#NAME') || geocodeScript.includes('#ERROR')) {
        return null;
    }
    
    const coords = geocodeScript.split(',').map(coord => coord.trim());
    if (coords.length === 2) {
        const lat = parseFloat(coords[0]);
        const lng = parseFloat(coords[1]);
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            return { lat, lng };
        }
    }
    return null;
}

// Standardize tag formatting
function standardizeTag(tag) {
    return tag ? tag.toString().toLowerCase().trim() : '';
}

// Parse location data
function parseLocationData(locationString) {
    if (!locationString) return { city: '', region: '', fullLocation: '', cityStandardized: '' };
    
    const parts = locationString.split(',').map(part => part.trim());
    
    if (parts.length >= 2) {
        const city = parts[0];
        const region = parts[1];
        
        // Location mappings for region names
        const LOCATION_MAPPINGS = {
            'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
            'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
            'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
            'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
            'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
            'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
            'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
            'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
            'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
            'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
            'PR': 'Puerto Rico', 'DC': 'District of Columbia'
        };
        
        const fullRegion = LOCATION_MAPPINGS[region.toUpperCase()] || region;
        
        return {
            city: city,
            region: region,
            fullRegion: fullRegion,
            fullLocation: `${city}, ${fullRegion}`,
            originalLocation: locationString,
            cityStandardized: standardizeTag(city),
            fullRegionStandardized: standardizeTag(fullRegion),
            fullLocationStandardized: standardizeTag(`${city}, ${fullRegion}`)
        };
    }
    
    return {
        city: locationString,
        region: '',
        fullRegion: '',
        fullLocation: locationString,
        originalLocation: locationString,
        cityStandardized: standardizeTag(locationString),
        fullRegionStandardized: '',
        fullLocationStandardized: standardizeTag(locationString)
    };
}

// Get TikTok thumbnail path
function getCachedThumbnailPath(tikTokVideoUrl) {
    if (!tikTokVideoUrl) return null;
    const match = tikTokVideoUrl.match(/\/video\/(\d+)/);
    return match ? `thumbnails/${match[1]}.jpeg` : null;
}

// Main processing function
async function main() {
    const csvUrl = process.env.GOOGLE_SHEETS_URL;
    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (!csvUrl) {
        throw new Error('GOOGLE_SHEETS_URL environment variable is required');
    }
    
    if (!googleApiKey) {
        throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
    }
    
    // Retry the entire process if we get too many coordinate errors
    for (let mainAttempt = 1; mainAttempt <= 3; mainAttempt++) {
        try {
            console.log(`🚀 Main processing attempt ${mainAttempt}/3`);
            
            // Fetch and parse CSV data
            const csvText = await fetchCSVWithRetry(csvUrl);
            const rawData = parseCSV(csvText);
        
        console.log(`📋 Processing ${rawData.length} rows from CSV...`);
        
        // Process each restaurant
        const restaurants = [];
        let validCount = 0;
        let skippedCount = 0;
        let coordinateErrors = 0;
        
        for (const row of rawData) {
            // Check required fields
            if (!row.Restaurant?.trim() || !row.Address?.trim()) {
                console.log(`⚠️ Skipping row: missing Restaurant or Address`);
                skippedCount++;
                continue;
            }
            
            console.log(`🔄 Processing ${row.Restaurant}...`);
            
            // Generate coordinates using geocoding API
            const geocodeResult = await geocodeAddress(row.Address?.trim(), googleApiKey);
            if (!geocodeResult) {
                console.log(`⚠️ Skipping ${row.Restaurant}: unable to geocode address`);
                skippedCount++;
                coordinateErrors++;
                continue;
            }
            
            const coords = validateCoordinates(geocodeResult);
            if (!coords) {
                console.log(`⚠️ Skipping ${row.Restaurant}: invalid coordinates from geocoding`);
                skippedCount++;
                coordinateErrors++;
                continue;
            }
            
            // Generate thumbnail for TikTok video
            const tikTokVideoUrl = row['TikTok Video']?.trim() || '';
            const cachedThumbnailPath = getCachedThumbnailPath(tikTokVideoUrl);
            let thumbnailUrl = null;
            
            // Check if cached thumbnail actually exists on disk
            const thumbnailExists = cachedThumbnailPath && fs.existsSync(path.join(process.cwd(), cachedThumbnailPath));
            
            if (thumbnailExists) {
                thumbnailUrl = cachedThumbnailPath;
            } else if (tikTokVideoUrl && cachedThumbnailPath) {
                // Fetch and download thumbnail if no cached version exists
                const fetchedThumbnailUrl = await fetchTikTokThumbnail(tikTokVideoUrl);
                if (fetchedThumbnailUrl) {
                    const downloadSuccess = await downloadAndSaveThumbnail(fetchedThumbnailUrl, cachedThumbnailPath);
                    if (downloadSuccess) {
                        thumbnailUrl = cachedThumbnailPath; // Use local path after successful download
                    } else {
                        thumbnailUrl = fetchedThumbnailUrl; // Fall back to remote URL if download failed
                    }
                }
            }
            
            // Skip if no valid thumbnail available
            if (!thumbnailUrl) {
                console.log(`⚠️ Skipping ${row.Restaurant}: no valid thumbnail available`);
                skippedCount++;
                continue;
            }
            
            // Process tags
            const tags = row.Tags ? 
                row.Tags.split(',')
                    .map(tag => standardizeTag(tag))
                    .filter(tag => tag) : 
                [];
            
            // Parse location data
            const locationData = parseLocationData(row.Location);
            
            // Process restaurant data
            const restaurant = {
                reviewer: row.Reviewer ? standardizeTag(row.Reviewer) : 'unknown',
                restaurant: row.Restaurant.trim(),
                tags: tags,
                location: locationData.originalLocation,
                locationData: locationData,
                address: row.Address.trim(),
                city: standardizeTag(locationData.city),
                googleMapsLink: row['Google Maps Link']?.trim() || '',
                latitude: coords.lat,
                longitude: coords.lng,
                rating: parseFloat(row['Bigger Belly Rating']) || 0,
                tikTokVideo: tikTokVideoUrl,
                tikTokThumbnail: thumbnailUrl,
                tikTokThumbnailFallback: thumbnailUrl,
                datePosted: row['Date of Posted Video']?.trim() || ''
            };
            
            restaurants.push(restaurant);
            validCount++;
        }
        
        console.log(`✅ Processed ${validCount} valid restaurants, skipped ${skippedCount}`);
        console.log(`📍 Coordinate errors: ${coordinateErrors}/${rawData.length} restaurants`);
        
        // Check if we have too many coordinate errors (likely means CSV has formula errors)
        const coordinateErrorRate = coordinateErrors / rawData.length;
        if (coordinateErrorRate > 0.5 && coordinateErrors > 10) {
            throw new Error(`High coordinate error rate (${Math.round(coordinateErrorRate * 100)}%) - likely CSV formula errors. Will retry.`);
        }
        
        // Create output data structure
        const outputData = {
            version: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            totalRestaurants: validCount,
            restaurants: restaurants
        };
        
        // Ensure data directory exists
        const dataDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
            // Write to JSON file
            const outputPath = path.join(dataDir, 'restaurants.json');
            fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
            
            console.log(`🎉 Successfully wrote ${validCount} restaurants to ${outputPath}`);
            
            // Success! Break out of retry loop
            return;
            
        } catch (error) {
            console.error(`❌ Attempt ${mainAttempt} failed:`, error.message);
            
            if (mainAttempt === 3) {
                console.error('❌ All retry attempts failed');
                process.exit(1);
            }
            
            // Wait before retrying main process (30 seconds)
            console.log('⏱️ Waiting 30 seconds before retry...');
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    }
}

main();