const fs = require('fs');
const path = require('path');

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
    const lines = csvText.trim().split('\n');
    
    if (lines.length < 2) {
        return [];
    }
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row = {};
        
        headers.forEach((header, index) => {
            row[header] = values[index] ? values[index].trim().replace(/"/g, '') : '';
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
    try {
        const csvUrl = process.env.GOOGLE_SHEETS_URL;
        if (!csvUrl) {
            throw new Error('GOOGLE_SHEETS_URL environment variable is required');
        }
        
        // Fetch and parse CSV data
        const csvText = await fetchCSVWithRetry(csvUrl);
        const rawData = parseCSV(csvText);
        
        console.log(`📋 Processing ${rawData.length} rows from CSV...`);
        
        // Process each restaurant
        const restaurants = [];
        let validCount = 0;
        let skippedCount = 0;
        
        for (const row of rawData) {
            // Check required fields
            if (!row.Restaurant?.trim() || !row.Address?.trim()) {
                console.log(`⚠️ Skipping row: missing Restaurant or Address`);
                skippedCount++;
                continue;
            }
            
            // Validate coordinates
            const coords = validateCoordinates(row['GeoCode Script']);
            if (!coords) {
                console.log(`⚠️ Skipping ${row.Restaurant}: invalid coordinates`);
                skippedCount++;
                continue;
            }
            
            // Check for thumbnail (either cached or external URL)
            const tikTokVideoUrl = row['TikTok Video']?.trim() || '';
            const cachedThumbnailPath = getCachedThumbnailPath(tikTokVideoUrl);
            const externalThumbnailUrl = row['TikTok Thumbnail']?.trim() || '';
            
            const hasValidThumbnail = cachedThumbnailPath || (
                externalThumbnailUrl && 
                !externalThumbnailUrl.includes('#NAME?') && 
                !externalThumbnailUrl.includes('#ERROR') && 
                externalThumbnailUrl.startsWith('https://')
            );
            
            if (!hasValidThumbnail) {
                console.log(`⚠️ Skipping ${row.Restaurant}: no valid thumbnail`);
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
                tikTokThumbnail: cachedThumbnailPath || externalThumbnailUrl,
                tikTokThumbnailFallback: externalThumbnailUrl,
                datePosted: row['Date of Posted Video']?.trim() || ''
            };
            
            restaurants.push(restaurant);
            validCount++;
        }
        
        console.log(`✅ Processed ${validCount} valid restaurants, skipped ${skippedCount}`);
        
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
        
    } catch (error) {
        console.error('❌ Error processing restaurant data:', error);
        process.exit(1);
    }
}

main();