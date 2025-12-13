// Configuration
const CONFIG = {
    version: '2.5.1',
    // Replace this URL with your actual Google Sheets CSV URL
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQtrN1wVBB0UvqmHkDvlme4DbWnIs2C29q8-vgJfSzM-OwAV0LMUJRm4CgTKXI0VqQkayz3eiv_a3tE/pub?gid=1869802255&single=true&output=csv',
    
    // Geocode cache configuration
    cacheUrl: 'data/geocode-cache.json',
    enableCache: true,
    
    // Default map center (will be updated based on restaurant locations)
    defaultCenter: [40.7128, -74.0060], // New York City
    defaultZoom: 10
};

// Global variables
let map;
let restaurants = [];
let markers = [];
let allTags = new Set();
let allReviewers = new Set();
let selectedTags = new Set();
// selectedReviewer removed - now using tags
let currentSort = 'newest';
let currentPage = 1;
let itemsPerPage = 24;
let totalFilteredRestaurants = 0;

// Cache variables
let geocodeCache = null;
let csvData = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.log(`🍔 Bigger Belly Boys v${CONFIG.version} - Loading...`);
    initializeMap();
    setupEventListeners();
    setupBrowserNavigation();
    initializeFromUrl();
    loadRestaurantData();
});

// Go to home page (clear all filters and URL parameters)
function goToHomePage() {
    // Clear all filters
    clearAllFilters();
    
    // Remove all URL parameters and go to base URL
    window.history.pushState({}, '', window.location.pathname);
    
    // Reset to first page
    currentPage = 1;
    
    // Re-display all restaurants
    sortAndDisplayRestaurants();
}

// Load geocode cache from JSON file
async function loadGeocodeCache() {
    if (!CONFIG.enableCache) return null;
    
    try {
        const response = await fetch(`${CONFIG.cacheUrl}?_t=${Date.now()}`);
        if (!response.ok) {
            console.log('📦 No geocode cache found, will use CSV data only');
            return null;
        }
        
        const cache = await response.json();
        console.log(`📦 Loaded geocode cache v${cache.version} (${Object.keys(cache.restaurants).length} entries)`);
        return cache;
    } catch (error) {
        console.warn('⚠️ Failed to load geocode cache:', error.message);
        return null;
    }
}

// Generate restaurant hash for cache key
function generateRestaurantHash(restaurant, address) {
    // Create a simple hash from restaurant name + address
    const key = `${restaurant}_${address}`.toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .substring(0, 50);
    return key;
}

// Get coordinates from cache or CSV
function getRestaurantCoordinates(row, cache) {
    const restaurantHash = generateRestaurantHash(row.Restaurant, row.Address);
    
    // Try cache first
    if (cache && cache.restaurants[restaurantHash]) {
        const cached = cache.restaurants[restaurantHash];
        return {
            lat: cached.coordinates.lat,
            lng: cached.coordinates.lng,
            source: 'cache'
        };
    }
    
    // Try GeoCode Script from CSV
    const geoCodeScript = row['GeoCode Script'] ? row['GeoCode Script'].toString().trim() : '';
    if (geoCodeScript) {
        const coords = geoCodeScript.split(',').map(coord => coord.trim());
        if (coords.length === 2) {
            const lat = parseFloat(coords[0]);
            const lng = parseFloat(coords[1]);
            if (!isNaN(lat) && !isNaN(lng)) {
                return {
                    lat: lat,
                    lng: lng,
                    source: 'csv_geocode'
                };
            }
        }
    }
    
    // No valid coordinates found
    return {
        lat: NaN,
        lng: NaN,
        source: 'none'
    };
}

// Update cache with new coordinate data (for future use)
function updateCacheEntry(restaurant, address, location, lat, lng, source = 'geocode_api') {
    if (!geocodeCache) {
        geocodeCache = {
            version: "1.0.0",
            lastUpdated: new Date().toISOString(),
            restaurants: {}
        };
    }
    
    const hash = generateRestaurantHash(restaurant, address);
    geocodeCache.restaurants[hash] = {
        name: restaurant,
        address: address,
        location: location,
        coordinates: { lat: lat, lng: lng },
        source: source,
        lastGeocoded: new Date().toISOString()
    };
    
    geocodeCache.lastUpdated = new Date().toISOString();
}

// Save cache to JSON file (requires server-side support)
async function saveGeocodeCache() {
    // Note: This would require a server endpoint to write files
    // For now, this is a placeholder for future implementation
    console.log('💾 Cache save requested - requires server-side implementation');
    console.log('Cache data:', geocodeCache);
}

// Get cache statistics
function getCacheStats() {
    if (!geocodeCache) return { entries: 0, version: 'none' };
    
    return {
        entries: Object.keys(geocodeCache.restaurants).length,
        version: geocodeCache.version,
        lastUpdated: geocodeCache.lastUpdated
    };
}

// Initialize Leaflet map
function initializeMap() {
    map = L.map('map').setView(CONFIG.defaultCenter, CONFIG.defaultZoom);
    
    // Add CartoDB Positron tiles (clean, minimal style)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
}

// Setup event listeners
function setupEventListeners() {
    // Filter toggle for mobile
    const filterToggle = document.getElementById('filter-toggle-btn');
    const filterContent = document.querySelector('.filter-content');
    
    filterToggle.addEventListener('click', function() {
        filterContent.classList.toggle('active');
    });
    
    // Clear filters button
    document.getElementById('clear-filters').addEventListener('click', clearAllFilters);
    
    // Tag search filter
    setupTagSearch();
    
    // Rating slider filter
    const ratingSlider = document.getElementById('rating-filter');
    const ratingValueDisplay = document.getElementById('rating-value');
    
    ratingSlider.addEventListener('input', function() {
        const value = parseFloat(this.value);
        ratingValueDisplay.textContent = value === 0 ? '0+' : `${value}+`;
        currentPage = 1; // Reset to first page when rating changes
        applyFilters();
    });
    
    // Sort filter
    document.getElementById('sort-filter').addEventListener('change', function() {
        currentSort = this.value;
        currentPage = 1; // Reset to first page when sorting changes
        updateUrl();
        sortAndDisplayRestaurants();
    });
}

// Initialize state from URL parameters
function initializeFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    
    // Get page from URL
    const pageParam = urlParams.get('page');
    if (pageParam) {
        const page = parseInt(pageParam);
        if (page > 0) {
            currentPage = page;
        }
    }
    
    // Get sort from URL
    const sortParam = urlParams.get('sort');
    if (sortParam && ['newest', 'oldest', 'rating-desc', 'rating-asc'].includes(sortParam)) {
        currentSort = sortParam;
        // Update the dropdown to match
        const sortDropdown = document.getElementById('sort-filter');
        if (sortDropdown) {
            sortDropdown.value = sortParam;
        }
    }
    
    // Get tags from URL
    const tagsParam = urlParams.get('tags');
    if (tagsParam) {
        selectedTags.clear();
        const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag);
        tags.forEach(tag => selectedTags.add(tag));
        // Update display after DOM is ready
        setTimeout(() => updateSelectedTagsDisplay(), 0);
    }
    
    // Get rating from URL
    const ratingParam = urlParams.get('rating');
    if (ratingParam) {
        const rating = parseFloat(ratingParam);
        if (!isNaN(rating)) {
            const ratingSlider = document.getElementById('rating-filter');
            if (ratingSlider) {
                ratingSlider.value = rating.toString();
                const ratingValueDisplay = document.getElementById('rating-value');
                if (ratingValueDisplay) {
                    ratingValueDisplay.textContent = `${rating}+`;
                }
            }
        }
    }
    
    // Create initial history entry with current state
    const url = new URL(window.location);
    if (currentPage > 1) {
        url.searchParams.set('page', currentPage.toString());
    }
    if (currentSort !== 'newest') {
        url.searchParams.set('sort', currentSort);
    }
    if (selectedTags.size > 0) {
        url.searchParams.set('tags', Array.from(selectedTags).join(','));
    }
    if (ratingParam && !isNaN(parseFloat(ratingParam))) {
        url.searchParams.set('rating', ratingParam);
    }
    window.history.replaceState({}, '', url);
}

// Initialize state from URL parameters (for navigation only - no history modification)
function initializeFromUrlForNavigation() {
    const urlParams = new URLSearchParams(window.location.search);
    
    // Get page from URL
    const pageParam = urlParams.get('page');
    if (pageParam) {
        const page = parseInt(pageParam);
        if (page > 0) {
            currentPage = page;
        }
    } else {
        currentPage = 1;
    }
    
    // Get sort from URL
    const sortParam = urlParams.get('sort');
    if (sortParam && ['newest', 'oldest', 'rating-desc', 'rating-asc'].includes(sortParam)) {
        currentSort = sortParam;
        // Update the dropdown to match
        const sortDropdown = document.getElementById('sort-filter');
        if (sortDropdown) {
            sortDropdown.value = sortParam;
        }
    } else {
        currentSort = 'newest';
        const sortDropdown = document.getElementById('sort-filter');
        if (sortDropdown) {
            sortDropdown.value = 'newest';
        }
    }
    
    // Get tags from URL
    const tagsParam = urlParams.get('tags');
    selectedTags.clear();
    if (tagsParam) {
        const tags = tagsParam.split(',').map(tag => tag.trim()).filter(tag => tag);
        tags.forEach(tag => selectedTags.add(tag));
    }
    updateSelectedTagsDisplay();
    
    // Get rating from URL
    const ratingParam = urlParams.get('rating');
    const ratingSlider = document.getElementById('rating-filter');
    const ratingValueDisplay = document.getElementById('rating-value');
    
    if (ratingParam && ratingSlider) {
        const rating = parseFloat(ratingParam);
        if (!isNaN(rating)) {
            ratingSlider.value = rating.toString();
            if (ratingValueDisplay) {
                ratingValueDisplay.textContent = `${rating}+`;
            }
        }
    } else if (ratingSlider) {
        // Reset to minimum if no rating param
        ratingSlider.value = ratingSlider.min;
        if (ratingValueDisplay) {
            ratingValueDisplay.textContent = `${ratingSlider.min}+`;
        }
    }
    
}

// Update URL with current state
function updateUrl() {
    const oldUrl = window.location.href;
    const url = new URL(window.location);
    
    // Set page parameter
    if (currentPage > 1) {
        url.searchParams.set('page', currentPage.toString());
    } else {
        url.searchParams.delete('page');
    }
    
    // Set sort parameter
    if (currentSort !== 'newest') {
        url.searchParams.set('sort', currentSort);
    } else {
        url.searchParams.delete('sort');
    }
    
    // Set tags parameter
    if (selectedTags.size > 0) {
        url.searchParams.set('tags', Array.from(selectedTags).join(','));
    } else {
        url.searchParams.delete('tags');
    }
    
    // Set rating parameter
    const ratingSlider = document.getElementById('rating-filter');
    if (ratingSlider) {
        const currentRating = parseFloat(ratingSlider.value);
        const minRating = parseFloat(ratingSlider.min);
        if (currentRating > minRating) {
            url.searchParams.set('rating', currentRating.toString());
        } else {
            url.searchParams.delete('rating');
        }
    }
    
    const newUrl = url.href;
    
    // Only push to history if the URL actually changed
    if (oldUrl !== newUrl) {
        window.history.pushState({}, '', url);
    }
}

// Setup browser navigation (back/forward buttons)
function setupBrowserNavigation() {
    window.addEventListener('popstate', function(event) {
        // Re-initialize from URL parameters when user navigates
        initializeFromUrlForNavigation();
        
        // If restaurants are already loaded, apply the URL state immediately
        if (restaurants.length > 0) {
            sortAndDisplayRestaurants();
            // Also apply filters to ensure everything is in sync (skip URL update to avoid creating new history)
            applyFilters(true);
        }
    });
}

// Lazy loading removed for better user experience

// Load restaurant data from cache and CSV
async function loadRestaurantData() {
    const loadingElement = document.getElementById('loading');
    
    try {
        if (CONFIG.csvUrl === 'PASTE_YOUR_GOOGLE_SHEETS_CSV_URL_HERE') {
            throw new Error('Please update the CSV URL in the CONFIG object');
        }
        
        // Load geocode cache first
        geocodeCache = await loadGeocodeCache();
        
        // Load CSV data
        const response = await fetch(`${CONFIG.csvUrl}&_t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        const parsedData = parseCSV(csvText);
        csvData = parsedData; // Store for future cache updates
        
        restaurants = await processRestaurantData(parsedData, geocodeCache);
        
        if (restaurants.length === 0) {
            throw new Error('No valid restaurant data found');
        }
        
        createMapMarkers();
        sortAndDisplayRestaurants();
        setupFilters();
        // Map will be centered by displayPaginatedRestaurants when restaurants are displayed
        
        loadingElement.classList.add('hidden');
        console.log(`✅ Loaded ${restaurants.length} restaurants successfully`);
        
    } catch (error) {
        console.error('❌ Error loading restaurant data:', error);
        loadingElement.innerHTML = `
            <div class="spinner" style="display: none;"></div>
            <p>Error loading restaurant data: ${error.message}</p>
            <p style="font-size: 0.9rem; margin-top: 1rem;">
                ${CONFIG.csvUrl === 'PASTE_YOUR_GOOGLE_SHEETS_CSV_URL_HERE' ? 
                  'Please update the CSV URL in js/app.js' : 
                  'Please check your internet connection and try again.'}
            </p>
        `;
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

// Extract TikTok video ID from URL
function extractTikTokVideoId(url) {
    if (!url) return null;
    const match = url.match(/\/video\/(\d+)/);
    return match ? match[1] : null;
}

// Get cached thumbnail path for a TikTok video
function getCachedThumbnailPath(tikTokVideoUrl) {
    const videoId = extractTikTokVideoId(tikTokVideoUrl);
    return videoId ? `thumbnails/${videoId}.jpeg` : null;
}

// Check if cached thumbnail actually exists
async function cachedThumbnailExists(thumbnailPath) {
    if (!thumbnailPath) return false;
    
    try {
        const response = await fetch(thumbnailPath, { method: 'HEAD' });
        return response.ok;
    } catch (error) {
        return false;
    }
}

// Location mapping and standardization system
const LOCATION_MAPPINGS = {
    // US States and territories
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
    'PR': 'Puerto Rico', 'DC': 'District of Columbia',
    
    // Countries (common abbreviations)
    'MX': 'Mexico', 'JP': 'Japan', 'UK': 'United Kingdom', 'FR': 'France', 'DE': 'Germany',
    'IT': 'Italy', 'ES': 'Spain', 'AU': 'Australia', 'NZ': 'New Zealand', 'SG': 'Singapore',
    'TH': 'Thailand', 'PH': 'Philippines', 'KR': 'South Korea', 'TW': 'Taiwan', 'HK': 'Hong Kong'
};

// Parse location from Location column (not address)
function parseLocationData(locationString) {
    if (!locationString) return { city: '', region: '', fullLocation: '', searchableLocation: '' };
    
    // Parse "City, Region" format from Location column
    const parts = locationString.split(',').map(part => part.trim());
    
    if (parts.length >= 2) {
        const city = parts[0];
        const region = parts[1];
        
        // Get full region name for display (e.g., "PR" -> "Puerto Rico")
        const fullRegion = LOCATION_MAPPINGS[region.toUpperCase()] || region;
        
        // Create searchable location string (for filtering)
        const searchableLocation = `${city}, ${fullRegion}`.toLowerCase();
        
        return {
            city: city,
            region: region,
            fullRegion: fullRegion,
            fullLocation: `${city}, ${fullRegion}`,
            searchableLocation: searchableLocation,
            originalLocation: locationString
        };
    }
    
    // Fallback for single location (just city)
    return {
        city: locationString,
        region: '',
        fullRegion: '',
        fullLocation: locationString,
        searchableLocation: locationString.toLowerCase(),
        originalLocation: locationString
    };
}

// Extract city from address string (fallback only)
function extractCityFromAddress(address) {
    if (!address) return '';
    
    // Common address formats:
    // "123 Main St, New York, NY 10001"
    // "456 Oak Ave, Los Angeles, CA"
    // "789 Pine Rd, Chicago IL 60601"
    
    const parts = address.split(',').map(part => part.trim());
    
    if (parts.length >= 2) {
        // Second part is usually the city
        let city = parts[1].trim();
        
        // Remove state abbreviations and zip codes from city name
        city = city.replace(/\s+[A-Z]{2}(\s+\d{5})?$/i, '').trim();
        
        return city;
    }
    
    // Fallback: try to extract from single comma-separated format
    if (parts.length === 1) {
        const match = address.match(/,\s*([^,\d]+?)(?:\s+[A-Z]{2})?\s*\d*$/i);
        if (match) {
            return match[1].trim();
        }
    }
    
    return '';
}

// Format address with clickable location (city for filtering)
function formatAddressWithClickableLocation(address, locationData) {
    if (!locationData || !locationData.city) return address;
    
    const city = locationData.city;
    
    // Replace the city part in the address with a clickable span
    const cityRegex = new RegExp(`(,\\s*)(${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(\\s*,|\\s+[A-Z]{2}|\\s*$)`, 'i');
    
    // Use the full display location (e.g., "San Juan, Puerto Rico") for the filter
    const filterLocation = locationData.fullLocation;
    
    return address.replace(cityRegex, (match, beforeCity, cityMatch, afterCity) => {
        return `${beforeCity}<span class="clickable-city" onclick="selectLocationTag(event, '${filterLocation}')" title="Filter by ${filterLocation}">${cityMatch}</span>${afterCity}`;
    });
}

// Legacy function for backwards compatibility
function formatAddressWithClickableCity(address, city) {
    if (!city) return address;
    
    // Replace the city part in the address with a clickable span
    const cityRegex = new RegExp(`(,\\s*)(${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(\\s*,|\\s+[A-Z]{2}|\\s*$)`, 'i');
    
    return address.replace(cityRegex, (match, beforeCity, cityMatch, afterCity) => {
        return `${beforeCity}<span class="clickable-city" onclick="selectCityTag(event, '${city}')">${cityMatch}</span>${afterCity}`;
    });
}

// Get reviewer-specific rating icon with fallback
function getReviewerIcon(reviewer) {
    if (!reviewer) return 'src/vlad-bbb.png';
    
    const reviewerName = reviewer.toLowerCase().trim();
    switch (reviewerName) {
        case 'andrew':
            return 'src/andrew-bbb.png';
        case 'jason':
            return 'src/jason-bbb.png';
        default:
            return 'src/vlad-bbb.png';
    }
}

// Process and validate restaurant data
async function processRestaurantData(rawData, cache) {
    const requiredFields = ['Restaurant', 'Address'];
    
    const validationResults = await Promise.all(rawData.map(async (row, index) => {
        // Check each required field
        const missingFields = [];
        requiredFields.forEach(field => {
            if (!row[field] || row[field].trim() === '') {
                missingFields.push(field);
            }
        });
        
        // Get coordinates from cache or CSV
        const coordinates = getRestaurantCoordinates(row, cache);
        const lat = coordinates.lat;
        const lng = coordinates.lng;
        const coordinateSource = coordinates.source;
        
        const validCoordinates = !isNaN(lat) && !isNaN(lng) && 
                                lat >= -90 && lat <= 90 && 
                                lng >= -180 && lng <= 180;
        
        // Validate TikTok Thumbnail URL (only required if no cached thumbnail exists)
        const tikTokVideoUrl = row['TikTok Video'] ? row['TikTok Video'].trim() : '';
        const cachedThumbnailPath = getCachedThumbnailPath(tikTokVideoUrl);
        const tikTokThumbnail = row['TikTok Thumbnail'] ? row['TikTok Thumbnail'].trim() : '';
        
        // URL regex to validate proper URL format
        const urlRegex = /^https?:\/\/.+\..+/;
        
        // Check if cached thumbnail actually exists
        const hasCachedThumbnail = await cachedThumbnailExists(cachedThumbnailPath);
        
        // If we have a valid cached thumbnail, we don't need to validate the external URL
        // If no cached thumbnail, require a valid external URL (https AND proper URL format)
        // Skip external URL validation if it contains formula errors but we have a cached thumbnail
        const hasValidExternalUrl = tikTokThumbnail && 
                                   !tikTokThumbnail.includes('#NAME?') && 
                                   !tikTokThumbnail.includes('Error:') && 
                                   tikTokThumbnail.startsWith('https://') && 
                                   urlRegex.test(tikTokThumbnail);
        
        const validThumbnailUrl = hasCachedThumbnail || hasValidExternalUrl;
        
        const isValid = missingFields.length === 0 && validCoordinates && validThumbnailUrl;
        
        return { row, isValid, coordinateSource, latitude: lat, longitude: lng };
    }));
    
    // Filter valid rows and collect coordinate source stats
    const validResults = validationResults.filter(result => result.isValid);
    const validData = validResults.map(result => result.row);
    
    // Log validation summary
    console.log(`✅ Loaded ${validData.length}/${rawData.length} restaurants from CSV`);
    if (validData.length === 0) {
        console.error('❌ No valid restaurants found in CSV data');
    }
    
    const processedData = validResults.map((result, index) => {
        const row = result.row;
        // Process tags
        const tags = row.Tags ? 
            row.Tags.split(',').map(tag => tag.trim()).filter(tag => tag) : 
            [];
        
        // Tags processed and ready
        
        // Add tags to global set
        tags.forEach(tag => allTags.add(tag));
        
        // Add reviewer to global sets
        if (row.Reviewer && row.Reviewer.trim()) {
            const reviewerName = row.Reviewer.trim();
            allReviewers.add(reviewerName);
            // Don't add reviewer to allTags here - we'll handle it in the search logic
        }
        
        // Parse and validate rating (out of 10)
        const rating = parseFloat(row['Bigger Belly Rating']);
        const validRating = !isNaN(rating) && rating >= 0 && rating <= 10 ? rating : 0;
        
        const tikTokVideoUrl = row['TikTok Video'] ? row['TikTok Video'].trim() : '';
        const cachedThumbnailPath = getCachedThumbnailPath(tikTokVideoUrl);
        const csvThumbnailUrl = row['TikTok Thumbnail'] ? row['TikTok Thumbnail'].trim() : '';
        
        const address = row.Address.trim();
        const locationData = parseLocationData(row.Location);
        const city = locationData.city; // Use city from Location column, not extracted from address
        
        // Use coordinates from validation section (already parsed from GeoCode Script or fallback)
        const latitude = result.latitude;
        const longitude = result.longitude;
        
        
        return {
            reviewer: row.Reviewer ? row.Reviewer.trim() : 'Unknown',
            restaurant: row.Restaurant.trim(),
            tags: tags,
            location: locationData.originalLocation, // Original location string from CSV
            locationData: locationData, // Full parsed location data
            address: address,
            city: city,
            googleMapsLink: row['Google Maps Link'] ? row['Google Maps Link'].trim() : '',
            latitude: latitude,
            longitude: longitude,
            rating: validRating,
            tikTokVideo: tikTokVideoUrl,
            tikTokThumbnail: cachedThumbnailPath || csvThumbnailUrl,
            tikTokThumbnailFallback: csvThumbnailUrl,
            datePosted: row['Date of Posted Video'] ? row['Date of Posted Video'].trim() : ''
        };
    });
    
    return processedData;
}

// Create map markers
function createMapMarkers() {
    restaurants.forEach((restaurant, index) => {
        const marker = L.marker([restaurant.latitude, restaurant.longitude])
            .addTo(map)
            .bindPopup(createPopupContent(restaurant));
        
        // Store reference to restaurant data
        marker.restaurantIndex = index;
        markers.push(marker);
    });
}

// Create popup content for map markers
function createPopupContent(restaurant) {
    return `
        <div class="popup-content">
            ${restaurant.tikTokThumbnail ? 
                `<img src="${restaurant.tikTokThumbnail}" alt="${restaurant.restaurant}" class="popup-thumbnail" onerror="this.src='${restaurant.tikTokThumbnailFallback}'; this.onerror=function(){this.style.display='none'}">` : 
                ''
            }
            <div class="popup-name">${restaurant.restaurant}</div>
            <div class="popup-location">📍 <span class="clickable-location" onclick="selectLocationTag(event, '${restaurant.locationData.fullLocation}')" title="Filter by ${restaurant.locationData.fullLocation}">${restaurant.locationData.fullLocation}</span></div>
            <div class="popup-address">${restaurant.address}</div>
            <div class="popup-rating">
                <span class="rating-value">${restaurant.rating.toFixed(1)}</span>
                <img src="${getReviewerIcon(restaurant.reviewer)}" alt="Bigger Belly Rating" class="rating-icon" onerror="this.src='src/vlad-bbb.png'">
            </div>
            <div class="popup-links">
                ${restaurant.tikTokVideo ? 
                    `<a href="${restaurant.tikTokVideo}" target="_blank">Watch Review</a>` : 
                    ''
                }
                ${restaurant.googleMapsLink ? 
                    `<a href="${restaurant.googleMapsLink}" target="_blank">View on Maps</a>` : 
                    ''
                }
            </div>
            <div class="popup-reviewer">Reviewed by: <span class="clickable-reviewer" onclick="selectReviewer('${restaurant.reviewer}')">${restaurant.reviewer}</span></div>
        </div>
    `;
}

// Sort and display restaurants
function sortAndDisplayRestaurants() {
    // Sort restaurants based on current sort option
    let sortedRestaurants = [...restaurants];
    
    switch (currentSort) {
        case 'rating-asc':
            sortedRestaurants.sort((a, b) => a.rating - b.rating);
            break;
        case 'rating-desc':
            sortedRestaurants.sort((a, b) => b.rating - a.rating);
            break;
        case 'oldest':
            // Sort by date posted (oldest first)
            sortedRestaurants.sort((a, b) => {
                const dateA = a.datePosted ? new Date(a.datePosted) : new Date(0);
                const dateB = b.datePosted ? new Date(b.datePosted) : new Date(0);
                return dateA - dateB;
            });
            break;
        case 'newest':
        default:
            // Sort by date posted (newest first)
            sortedRestaurants.sort((a, b) => {
                const dateA = a.datePosted ? new Date(a.datePosted) : new Date(0);
                const dateB = b.datePosted ? new Date(b.datePosted) : new Date(0);
                return dateB - dateA;
            });
            break;
    }
    
    createRestaurantCards(sortedRestaurants);
    // Apply filters after creating new cards
    applyFilters();
}

// Create restaurant cards with pagination
function createRestaurantCards(sortedRestaurants = restaurants) {
    const restaurantList = document.getElementById('restaurant-list');
    restaurantList.innerHTML = '';
    
    // Store all sorted restaurants for filtering/pagination
    window.currentSortedRestaurants = sortedRestaurants;
    
    // Apply pagination - this will be updated by applyFilters
    displayPaginatedRestaurants(sortedRestaurants);
}

// Display paginated restaurants
function displayPaginatedRestaurants(filteredRestaurants) {
    const restaurantList = document.getElementById('restaurant-list');
    restaurantList.innerHTML = '';
    
    // Update total for pagination
    totalFilteredRestaurants = filteredRestaurants.length;
    
    // Calculate pagination
    const totalPages = Math.ceil(totalFilteredRestaurants / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalFilteredRestaurants);
    
    // Get restaurants for current page
    const restaurantsToShow = filteredRestaurants.slice(startIndex, endIndex);
    
    restaurantsToShow.forEach((restaurant, index) => {
        const originalIndex = restaurants.indexOf(restaurant);
        const card = document.createElement('div');
        card.className = 'restaurant-card';
        card.dataset.index = originalIndex; // Use original index for filtering
        
        const tagsHtml = restaurant.tags.map(tag => `<span class="tag clickable-tag" onclick="selectTag('${tag}')">${tag}</span>`).join('');
        
        card.innerHTML = `
            ${restaurant.tikTokThumbnail ? 
                `<img src="${restaurant.tikTokThumbnail}" alt="${restaurant.restaurant}" class="restaurant-thumbnail" onerror="this.src='${restaurant.tikTokThumbnailFallback}'; this.onerror=function(){this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDMwMCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRjBGMEYwIi8+Cjx0ZXh0IHg9IjE1MCIgeT0iNzUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJjZW50cmFsIiBmaWxsPSIjOTk5IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiPk5vIEltYWdlPC90ZXh0Pgo8L3N2Zz4K'}">` : 
                `<div class="restaurant-thumbnail no-image" style="background: #f0f0f0; display: flex; align-items: center; justify-content: center; color: #999; font-size: 14px; aspect-ratio: 1177 / 1570;">No Image</div>`
            }
            <div class="restaurant-info">
                <div class="restaurant-name">${restaurant.restaurant}</div>
                <div class="restaurant-location">📍 <span class="clickable-location" onclick="selectLocationTag(event, '${restaurant.locationData.fullLocation}')" title="Filter by ${restaurant.locationData.fullLocation}">${restaurant.locationData.fullLocation}</span></div>
                <div class="restaurant-address">${restaurant.address}</div>
                <div class="restaurant-rating">
                    <span class="rating-value">${restaurant.rating.toFixed(1)}</span>
                    <img src="${getReviewerIcon(restaurant.reviewer)}" alt="Bigger Belly Rating" class="rating-icon" onerror="this.src='src/vlad-bbb.png'">
                </div>
                <div class="restaurant-tags">${tagsHtml}</div>
                <div class="restaurant-reviewer">Reviewed by: <span class="clickable-reviewer" onclick="selectReviewer('${restaurant.reviewer}')">${restaurant.reviewer}</span></div>
            </div>
        `;
        
        // Add click event to zoom to marker
        card.addEventListener('click', () => {
            const marker = markers[originalIndex];
            map.setView([restaurant.latitude, restaurant.longitude], 15);
            marker.openPopup();
        });
        
        restaurantList.appendChild(card);
    });
    
    // Update pagination controls
    updatePaginationControls();
    
    // Center map on first result when results change
    if (currentPage === 1) {
        centerMapOnFirstResult();
    }
}

// Update pagination controls
function updatePaginationControls() {
    const paginationContainer = document.getElementById('pagination');
    const totalPages = Math.ceil(totalFilteredRestaurants / itemsPerPage);
    
    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    let paginationHtml = '<div class="pagination">';
    
    // Previous button
    if (currentPage > 1) {
        paginationHtml += `<button class="pagination-btn" onclick="goToPage(${currentPage - 1})">← Previous</button>`;
    }
    
    // Page numbers - show up to 5 page numbers
    const maxPagesToShow = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    
    // Adjust start page if we're near the end
    if (endPage - startPage + 1 < maxPagesToShow) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }
    
    // Add first page and ellipsis if needed
    if (startPage > 1) {
        paginationHtml += `<button class="pagination-btn" onclick="goToPage(1)">1</button>`;
        if (startPage > 2) {
            paginationHtml += '<span class="pagination-ellipsis">...</span>';
        }
    }
    
    // Add page numbers
    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentPage ? ' active' : '';
        paginationHtml += `<button class="pagination-btn${activeClass}" onclick="goToPage(${i})">${i}</button>`;
    }
    
    // Add last page and ellipsis if needed
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            paginationHtml += '<span class="pagination-ellipsis">...</span>';
        }
        paginationHtml += `<button class="pagination-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
    }
    
    // Next button
    if (currentPage < totalPages) {
        paginationHtml += `<button class="pagination-btn" onclick="goToPage(${currentPage + 1})">Next →</button>`;
    }
    
    paginationHtml += '</div>';
    
    // Add results info
    const startResult = totalFilteredRestaurants === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const endResult = Math.min(currentPage * itemsPerPage, totalFilteredRestaurants);
    paginationHtml += `<div class="pagination-info">Showing ${startResult}-${endResult} of ${totalFilteredRestaurants} restaurants</div>`;
    
    paginationContainer.innerHTML = paginationHtml;
}

// Navigate to a specific page
function goToPage(page) {
    const totalPages = Math.ceil(totalFilteredRestaurants / itemsPerPage);
    
    if (page >= 1 && page <= totalPages) {
        currentPage = page;
        updateUrl();
        
        // Get current filtered restaurants and display the correct page
        const filteredRestaurants = getFilteredRestaurants();
        displayPaginatedRestaurants(filteredRestaurants);
        
        // Scroll to top of restaurant list
        document.getElementById('restaurant-list').scrollIntoView({ behavior: 'smooth' });
    }
}

// Setup filter controls
function setupFilters() {
    setupDynamicRatingSlider();
}

// Setup dynamic rating slider based on actual data
function setupDynamicRatingSlider() {
    const ratings = restaurants.map(r => r.rating).filter(rating => rating > 0);
    
    if (ratings.length === 0) return;
    
    const minRating = Math.min(...ratings);
    const maxRating = Math.max(...ratings);
    
    const ratingSlider = document.getElementById('rating-filter');
    const ratingValueDisplay = document.getElementById('rating-value');
    
    // Update slider attributes
    ratingSlider.min = minRating;
    ratingSlider.max = maxRating;
    ratingSlider.value = minRating;
    ratingSlider.step = '0.1';
    
    // Update display
    ratingValueDisplay.textContent = `${minRating}+`;
    
    // Update slider labels
    const sliderLabels = document.querySelector('.slider-labels');
    sliderLabels.innerHTML = `
        <span>${minRating}</span>
        <span id="rating-value">${minRating}+</span>
        <span>${maxRating}</span>
    `;
    
    // Re-attach the event listener for the updated slider
    ratingSlider.addEventListener('input', function() {
        const value = parseFloat(this.value);
        const newRatingValueDisplay = document.getElementById('rating-value');
        newRatingValueDisplay.textContent = `${value}+`;
        currentPage = 1; // Reset to first page when rating changes
        updateUrl();
        applyFilters();
    });
    
}

// Setup tag search with autocomplete and multi-select
function setupTagSearch() {
    const tagInput = document.getElementById('tag-search');
    const suggestionsContainer = document.getElementById('tag-suggestions');
    const selectedTagsContainer = document.getElementById('selected-tags');
    
    tagInput.addEventListener('input', function() {
        const query = this.value.toLowerCase().trim();
        
        if (query.length === 0) {
            suggestionsContainer.classList.add('hidden');
            return;
        }
        
        // Get tags from restaurants that match current filters
        const currentRating = parseFloat(document.getElementById('rating-filter').value) || 0;
        
        const availableTagsFromFilteredRestaurants = new Set();
        restaurants.forEach(restaurant => {
            // Check if restaurant matches current selected tags and rating
            let matchesSelectedTags = true;
            if (selectedTags.size > 0) {
                matchesSelectedTags = Array.from(selectedTags).every(selectedTag => {
                    // Check if it matches a regular tag
                    const matchesTag = restaurant.tags.some(restaurantTag => 
                        restaurantTag.toLowerCase() === selectedTag.toLowerCase()
                    );
                    // Or check if it matches the reviewer
                    const matchesReviewer = restaurant.reviewer.toLowerCase() === selectedTag.toLowerCase();
                    // Or check if it matches location data
                    let matchesLocation = false;
                    if (restaurant.locationData) {
                        const cityMatch = restaurant.locationData.city && restaurant.locationData.city.toLowerCase() === selectedTag.toLowerCase();
                        const fullLocationMatch = restaurant.locationData.fullLocation && restaurant.locationData.fullLocation.toLowerCase() === selectedTag.toLowerCase();
                        const regionMatch = restaurant.locationData.fullRegion && restaurant.locationData.fullRegion.toLowerCase() === selectedTag.toLowerCase();
                        matchesLocation = cityMatch || fullLocationMatch || regionMatch;
                    }
                    
                    return matchesTag || matchesReviewer || matchesLocation;
                });
            }
            
            const matchesRating = restaurant.rating >= currentRating;
            
            if (matchesSelectedTags && matchesRating) {
                // Add regular tags
                restaurant.tags.forEach(tag => availableTagsFromFilteredRestaurants.add(tag));
                // Add this restaurant's reviewer as available tag
                if (restaurant.reviewer) {
                    availableTagsFromFilteredRestaurants.add(restaurant.reviewer);
                }
                // Add location-based tags
                if (restaurant.locationData) {
                    // Add the city name
                    if (restaurant.locationData.city) {
                        availableTagsFromFilteredRestaurants.add(restaurant.locationData.city);
                    }
                    // Add the full location (e.g., "San Juan, Puerto Rico")
                    if (restaurant.locationData.fullLocation) {
                        availableTagsFromFilteredRestaurants.add(restaurant.locationData.fullLocation);
                    }
                    // Add the region name (e.g., "Puerto Rico", "New York")
                    if (restaurant.locationData.fullRegion) {
                        availableTagsFromFilteredRestaurants.add(restaurant.locationData.fullRegion);
                    }
                }
            }
        });
        
        // Filter available tags based on input and current filters
        const availableTags = Array.from(availableTagsFromFilteredRestaurants).filter(tag => {
            return tag.toLowerCase().includes(query) && !selectedTags.has(tag);
        });
        
        if (availableTags.length === 0) {
            suggestionsContainer.classList.add('hidden');
            return;
        }
        
        // Show suggestions
        suggestionsContainer.innerHTML = '';
        availableTags.slice(0, 8).forEach(tag => { // Limit to 8 suggestions
            const suggestionItem = document.createElement('div');
            suggestionItem.className = 'tag-suggestion-item';
            suggestionItem.textContent = tag;
            suggestionItem.addEventListener('click', () => selectTag(tag));
            suggestionsContainer.appendChild(suggestionItem);
        });
        
        suggestionsContainer.classList.remove('hidden');
    });
    
    // Hide suggestions when clicking outside
    document.addEventListener('click', function(e) {
        if (!tagInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
            suggestionsContainer.classList.add('hidden');
        }
    });
    
    // Handle Enter key to select first suggestion
    tagInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const firstSuggestion = suggestionsContainer.querySelector('.tag-suggestion-item');
            if (firstSuggestion) {
                selectTag(firstSuggestion.textContent);
            }
        }
    });
}

function selectTag(tag) {
    // Don't add if already selected
    if (selectedTags.has(tag)) {
        return;
    }
    
    selectedTags.add(tag);
    updateSelectedTagsDisplay();
    
    // Clear input and hide suggestions
    document.getElementById('tag-search').value = '';
    document.getElementById('tag-suggestions').classList.add('hidden');
    
    // Auto-expand filters on mobile when tag is selected
    expandFiltersOnMobile();
    
    // Reset to first page when tag is selected
    currentPage = 1;
    updateUrl();
    
    applyFilters();
}

// Select city tag with event handling (prevents card click zooming)
function selectCityTag(event, city) {
    // Prevent event from bubbling up to the restaurant card click handler
    event.stopPropagation();
    
    // Use the regular selectTag function for the filtering logic
    selectTag(city);
}

// Select location tag with event handling (prevents card click zooming)
function selectLocationTag(event, location) {
    // Prevent event from bubbling up to the restaurant card click handler
    event.stopPropagation();
    
    // Use the regular selectTag function for the filtering logic
    selectTag(location);
}

// Auto-expand filters on mobile when interaction happens
function expandFiltersOnMobile() {
    // Check if we're on mobile (filter toggle is visible)
    const filterToggle = document.getElementById('filter-toggle-btn');
    if (filterToggle && window.getComputedStyle(filterToggle).display !== 'none') {
        const filterContent = document.querySelector('.filter-content');
        if (filterContent && !filterContent.classList.contains('active')) {
            filterContent.classList.add('active');
        }
    }
}

function removeTag(tag) {
    selectedTags.delete(tag);
    updateSelectedTagsDisplay();
    
    // Reset to first page when tag is removed
    currentPage = 1;
    updateUrl();
    
    applyFilters();
}

function selectReviewer(reviewer) {
    // Auto-expand filters on mobile when reviewer is selected
    expandFiltersOnMobile();
    // Now just use the existing tag selection system
    selectTag(reviewer);
}

function updateSelectedTagsDisplay() {
    const container = document.getElementById('selected-tags');
    container.innerHTML = '';
    
    selectedTags.forEach(tag => {
        const tagElement = document.createElement('div');
        tagElement.className = 'selected-tag';
        tagElement.innerHTML = `
            <span>${tag}</span>
            <button class="remove-tag" onclick="removeTag('${tag}')">&times;</button>
        `;
        container.appendChild(tagElement);
    });
}

// These functions are no longer needed with the new filter design

// Get filtered restaurants based on current filters
function getFilteredRestaurants() {
    const minRating = parseFloat(document.getElementById('rating-filter').value) || 0;
    const sortedRestaurants = window.currentSortedRestaurants || restaurants;
    
    return sortedRestaurants.filter(restaurant => {
        let show = true;
        
        // Filter by selected tags (must have ALL selected tags - includes reviewers)
        if (selectedTags.size > 0) {
            const hasAllSelectedTags = Array.from(selectedTags).every(selectedTag => {
                // Clean and normalize the selected tag
                const cleanSelectedTag = selectedTag.toLowerCase().trim();
                
                // Check if it matches a regular tag
                const matchesTag = restaurant.tags.some(restaurantTag => 
                    restaurantTag.toLowerCase().trim() === cleanSelectedTag
                );
                // Or check if it matches the reviewer
                const matchesReviewer = restaurant.reviewer.toLowerCase().trim() === cleanSelectedTag;
                // Or check if it matches location data
                let matchesLocation = false;
                if (restaurant.locationData) {
                    const cityMatch = restaurant.locationData.city && restaurant.locationData.city.toLowerCase().trim() === cleanSelectedTag;
                    const fullLocationMatch = restaurant.locationData.fullLocation && restaurant.locationData.fullLocation.toLowerCase().trim() === cleanSelectedTag;
                    const regionMatch = restaurant.locationData.fullRegion && restaurant.locationData.fullRegion.toLowerCase().trim() === cleanSelectedTag;
                    matchesLocation = cityMatch || fullLocationMatch || regionMatch;
                }
                
                return matchesTag || matchesReviewer || matchesLocation;
            });
            if (!hasAllSelectedTags) show = false;
        }
        
        // Filter by rating
        if (restaurant.rating < minRating) show = false;
        
        return show;
    });
}

// Apply filters with pagination
function applyFilters(skipUrlUpdate = false) {
    // Reset to first page when filters change (but not during navigation)
    if (!skipUrlUpdate) {
        currentPage = 1;
        updateUrl();
    }
    
    // Get filtered restaurants
    const filteredRestaurants = getFilteredRestaurants();
    
    // Update map markers visibility
    restaurants.forEach((restaurant, index) => {
        const marker = markers[index];
        const isFiltered = filteredRestaurants.includes(restaurant);
        
        if (isFiltered) {
            if (!map.hasLayer(marker)) {
                map.addLayer(marker);
            }
        } else {
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        }
    });
    
    // Display paginated filtered restaurants
    displayPaginatedRestaurants(filteredRestaurants);
}

// Clear all filters
function clearAllFilters() {
    // Clear selected tags
    selectedTags.clear();
    updateSelectedTagsDisplay();
    
    // Clear tag search input
    document.getElementById('tag-search').value = '';
    document.getElementById('tag-suggestions').classList.add('hidden');
    
    // Reset rating slider to minimum value
    const ratingSlider = document.getElementById('rating-filter');
    const ratingValueDisplay = document.getElementById('rating-value');
    ratingSlider.value = ratingSlider.min;
    ratingValueDisplay.textContent = `${ratingSlider.min}+`;
    
    // Reset sort to default
    currentSort = 'newest';
    document.getElementById('sort-filter').value = 'newest';
    
    // Reset pagination
    currentPage = 1;
    updateUrl();
    
    // Re-sort and display all restaurants
    sortAndDisplayRestaurants();
}

// Center map to show all restaurants with appropriate bounding box
function centerMapOnCenterOfMass() {
    if (restaurants.length === 0) return;
    
    // Find bounding box of all restaurant locations
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    let count = 0;
    
    restaurants.forEach(restaurant => {
        if (restaurant.latitude && restaurant.longitude) {
            minLat = Math.min(minLat, restaurant.latitude);
            maxLat = Math.max(maxLat, restaurant.latitude);
            minLng = Math.min(minLng, restaurant.longitude);
            maxLng = Math.max(maxLng, restaurant.longitude);
            count++;
        }
    });
    
    if (count > 0) {
        // Create bounding box with some padding
        const bounds = [
            [minLat, minLng],
            [maxLat, maxLng]
        ];
        
        // Fit map to show all restaurants with padding
        map.fitBounds(bounds, {
            padding: [20, 20], // Add 20px padding on all sides
            maxZoom: 12 // Don't zoom in too close even if restaurants are clustered
        });
        
    } else {
        // Fallback to NYC if no valid coordinates
        map.setView(CONFIG.defaultCenter, CONFIG.defaultZoom);
    }
}

// Center map on first filtered result with city-level zoom
function centerMapOnFirstResult() {
    const filteredRestaurants = getFilteredRestaurants();
    
    if (filteredRestaurants.length === 0) {
        // Fallback to showing all restaurants if no filtered results
        centerMapOnCenterOfMass();
        return;
    }
    
    const firstRestaurant = filteredRestaurants[0];
    if (firstRestaurant.latitude && firstRestaurant.longitude) {
        // Center on first result with city-level zoom (zoom 10-11 shows city + surrounding areas)
        map.setView([firstRestaurant.latitude, firstRestaurant.longitude], 11);
    } else {
        // Fallback to NYC if no valid coordinates
        map.setView(CONFIG.defaultCenter, CONFIG.defaultZoom);
    }
}

// Center map on all restaurants (fallback function)
function centerMapOnRestaurants() {
    if (restaurants.length === 0) return;
    
    const group = new L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.1));
}