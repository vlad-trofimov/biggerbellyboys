// Configuration
const CONFIG = {
    // Replace this URL with your actual Google Sheets CSV URL
    csvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQtrN1wVBB0UvqmHkDvlme4DbWnIs2C29q8-vgJfSzM-OwAV0LMUJRm4CgTKXI0VqQkayz3eiv_a3tE/pub?gid=1869802255&single=true&output=csv',
    
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

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeMap();
    setupEventListeners();
    loadRestaurantData();
});

// Initialize Leaflet map
function initializeMap() {
    map = L.map('map').setView(CONFIG.defaultCenter, CONFIG.defaultZoom);
    
    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
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
    
    // Rating filter
    document.getElementById('rating-filter').addEventListener('change', applyFilters);
}

// Load restaurant data from CSV
async function loadRestaurantData() {
    const loadingElement = document.getElementById('loading');
    
    try {
        console.log('🔄 Loading restaurant data from:', CONFIG.csvUrl);
        
        if (CONFIG.csvUrl === 'PASTE_YOUR_GOOGLE_SHEETS_CSV_URL_HERE') {
            throw new Error('Please update the CSV URL in the CONFIG object');
        }
        
        console.log('📡 Fetching CSV data...');
        const response = await fetch(CONFIG.csvUrl);
        console.log('📡 Response status:', response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        console.log('📄 CSV text length:', csvText.length);
        console.log('📄 First 200 characters of CSV:', csvText.substring(0, 200));
        
        const parsedData = parseCSV(csvText);
        console.log('📊 Parsed data rows:', parsedData.length);
        console.log('📊 Sample parsed row:', parsedData[0]);
        
        restaurants = processRestaurantData(parsedData);
        console.log('✅ Valid restaurants found:', restaurants.length);
        console.log('✅ Sample restaurant:', restaurants[0]);
        
        if (restaurants.length === 0) {
            console.error('❌ No valid restaurants found after processing!');
            console.error('📊 Debug info:');
            console.error('   - Raw CSV rows:', parsedData.length);
            console.error('   - Headers detected:', Object.keys(parsedData[0] || {}));
            console.error('   - Sample raw row:', parsedData[0]);
            throw new Error('No valid restaurant data found - check console for details');
        }
        
        console.log('🗺️ Creating map markers...');
        createMapMarkers();
        
        console.log('📋 Creating restaurant cards...');
        createRestaurantCards();
        
        console.log('🔧 Setting up filters...');
        setupFilters();
        
        console.log('📍 Centering map...');
        centerMapOnRestaurants();
        
        loadingElement.classList.add('hidden');
        console.log('🎉 Restaurant data loaded successfully!');
        
    } catch (error) {
        console.error('❌ Error loading restaurant data:', error);
        console.error('❌ Stack trace:', error.stack);
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
    console.log('🔍 Starting CSV parsing...');
    const lines = csvText.trim().split('\n');
    console.log('📄 Total lines in CSV:', lines.length);
    
    if (lines.length < 2) {
        console.error('❌ CSV has no data rows (only headers or empty)');
        return [];
    }
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    console.log('📋 Headers found:', headers);
    
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row = {};
        
        headers.forEach((header, index) => {
            row[header] = values[index] ? values[index].trim().replace(/"/g, '') : '';
        });
        
        data.push(row);
        
        // Log first few rows for debugging
        if (i <= 3) {
            console.log(`📊 Row ${i}:`, row);
        }
    }
    
    console.log('✅ CSV parsing complete. Data rows:', data.length);
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

// Process and validate restaurant data
function processRestaurantData(rawData) {
    console.log('🔍 Starting data validation and processing...');
    console.log('📊 Raw data rows to process:', rawData.length);
    
    let validCount = 0;
    let invalidCount = 0;
    
    // Define required fields based on the CSV column structure
    // Note: These field names must match your CSV headers exactly (case-sensitive)
    const requiredFields = ['Restaurant', 'Address', 'Latitude', 'Longitude'];
    
    console.log('🔍 Looking for required fields:', requiredFields);
    
    // Check if we have the required columns in our headers
    if (rawData.length > 0) {
        const availableFields = Object.keys(rawData[0]);
        console.log('📋 Available fields in CSV:', availableFields);
        
        const missingRequiredFields = requiredFields.filter(field => !availableFields.includes(field));
        if (missingRequiredFields.length > 0) {
            console.error('❌ Missing required columns in CSV:', missingRequiredFields);
            console.error('💡 Your CSV headers might be different. Common alternatives:');
            console.error('   - Restaurant → Name, Restaurant Name, Business Name');
            console.error('   - Address → Full Address, Street Address');
            console.error('   - Latitude → Lat, Y');
            console.error('   - Longitude → Lng, Long, X');
        }
    }
    
    const validData = rawData.filter((row, index) => {
        console.log(`🔍 Validating row ${index + 1}:`, {
            Restaurant: row.Restaurant,
            Address: row.Address,
            Latitude: row.Latitude,
            Longitude: row.Longitude
        });
        
        // Check each required field
        const missingFields = [];
        requiredFields.forEach(field => {
            if (!row[field] || row[field].trim() === '') {
                missingFields.push(field);
            }
        });
        
        // Validate coordinates (handle @ symbol prefix in latitude)
        const cleanLat = row.Latitude ? row.Latitude.toString().replace('@', '') : '';
        const cleanLng = row.Longitude ? row.Longitude.toString() : '';
        
        const lat = parseFloat(cleanLat);
        const lng = parseFloat(cleanLng);
        const validCoordinates = !isNaN(lat) && !isNaN(lng) && 
                                lat >= -90 && lat <= 90 && 
                                lng >= -180 && lng <= 180;
        
        console.log(`   Cleaned coordinates: lat="${cleanLat}" (${lat}), lng="${cleanLng}" (${lng}), valid: ${validCoordinates}`);
        
        if (missingFields.length > 0) {
            console.warn(`⚠️ Row ${index + 1} missing required fields:`, missingFields);
            invalidCount++;
            return false;
        }
        
        if (!validCoordinates) {
            console.warn(`⚠️ Row ${index + 1} has invalid coordinates: lat="${cleanLat}" (${lat}), lng="${cleanLng}" (${lng})`);
            invalidCount++;
            return false;
        }
        
        validCount++;
        return true;
    });
    
    console.log(`✅ Validation complete: ${validCount} valid, ${invalidCount} invalid rows`);
    
    const processedData = validData.map((row, index) => {
        // Process tags
        const tags = row.Tags ? 
            row.Tags.split(',').map(tag => tag.trim()).filter(tag => tag) : 
            [];
        
        // Add tags to global set
        tags.forEach(tag => allTags.add(tag));
        
        // Add reviewer to global set
        if (row.Reviewer && row.Reviewer.trim()) {
            allReviewers.add(row.Reviewer.trim());
        }
        
        // Parse and validate rating
        const rating = parseFloat(row['Bigger Belly Rating']);
        const validRating = !isNaN(rating) && rating >= 0 && rating <= 5 ? rating : 0;
        
        if (isNaN(rating) || rating < 0 || rating > 5) {
            console.warn(`⚠️ Invalid rating for ${row.Restaurant}: ${row['Bigger Belly Rating']}, defaulting to 0`);
        }
        
        const processedRow = {
            reviewer: row.Reviewer ? row.Reviewer.trim() : 'Unknown',
            restaurant: row.Restaurant.trim(),
            tags: tags,
            location: row.Location ? row.Location.trim() : '',
            address: row.Address.trim(),
            googleMapsLink: row['Google Maps Link'] ? row['Google Maps Link'].trim() : '',
            latitude: parseFloat(row.Latitude.toString().replace('@', '')),
            longitude: parseFloat(row.Longitude),
            rating: validRating,
            tikTokVideo: row['TikTok Video'] ? row['TikTok Video'].trim() : '',
            tikTokThumbnail: row['TikTok Thumbnail'] ? row['TikTok Thumbnail'].trim() : '',
            datePosted: row['Date of Posted Video'] ? row['Date of Posted Video'].trim() : ''
        };
        
        // Log first few processed rows
        if (index < 3) {
            console.log(`✅ Processed row ${index + 1}:`, processedRow);
        }
        
        return processedRow;
    });
    
    console.log(`🎯 Final processed restaurants: ${processedData.length}`);
    console.log(`🏷️ Unique tags found: ${Array.from(allTags).length}`);
    console.log(`👤 Unique reviewers found: ${Array.from(allReviewers).length}`);
    
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
    const stars = '★'.repeat(Math.floor(restaurant.rating)) + '☆'.repeat(5 - Math.floor(restaurant.rating));
    
    return `
        <div class="popup-content">
            ${restaurant.tikTokThumbnail ? 
                `<img src="${restaurant.tikTokThumbnail}" alt="${restaurant.restaurant}" class="popup-thumbnail" onerror="this.style.display='none'">` : 
                ''
            }
            <div class="popup-name">${restaurant.restaurant}</div>
            <div class="popup-address">${restaurant.address}</div>
            <div class="popup-rating">
                <span class="stars">${stars}</span>
                <span class="rating-value">${restaurant.rating}/5</span>
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
            <div class="popup-reviewer">Reviewed by: ${restaurant.reviewer}</div>
        </div>
    `;
}

// Create restaurant cards
function createRestaurantCards() {
    const restaurantList = document.getElementById('restaurant-list');
    restaurantList.innerHTML = '';
    
    restaurants.forEach((restaurant, index) => {
        const card = document.createElement('div');
        card.className = 'restaurant-card';
        card.dataset.index = index;
        
        const stars = '★'.repeat(Math.floor(restaurant.rating)) + '☆'.repeat(5 - Math.floor(restaurant.rating));
        const tagsHtml = restaurant.tags.map(tag => `<span class="tag">${tag}</span>`).join('');
        
        card.innerHTML = `
            ${restaurant.tikTokThumbnail ? 
                `<img src="${restaurant.tikTokThumbnail}" alt="${restaurant.restaurant}" class="restaurant-thumbnail" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDMwMCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMTUwIiBmaWxsPSIjRjBGMEYwIi8+Cjx0ZXh0IHg9IjE1MCIgeT0iNzUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJjZW50cmFsIiBmaWxsPSIjOTk5IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiPk5vIEltYWdlPC90ZXh0Pgo8L3N2Zz4K'">` : 
                `<div class="restaurant-thumbnail" style="background: #f0f0f0; display: flex; align-items: center; justify-content: center; color: #999; font-size: 14px;">No Image</div>`
            }
            <div class="restaurant-info">
                <div class="restaurant-name">${restaurant.restaurant}</div>
                <div class="restaurant-rating">
                    <span class="stars">${stars}</span>
                    <span class="rating-value">${restaurant.rating}/5</span>
                </div>
                <div class="restaurant-tags">${tagsHtml}</div>
                <div class="restaurant-reviewer">Reviewed by: ${restaurant.reviewer}</div>
            </div>
        `;
        
        // Add click event to zoom to marker
        card.addEventListener('click', () => {
            const marker = markers[index];
            map.setView([restaurant.latitude, restaurant.longitude], 15);
            marker.openPopup();
        });
        
        restaurantList.appendChild(card);
    });
}

// Setup filter controls
function setupFilters() {
    setupTagFilters();
    setupReviewerFilters();
}

// Setup tag filters
function setupTagFilters() {
    const tagFilters = document.getElementById('tag-filters');
    const sortedTags = Array.from(allTags).sort();
    
    tagFilters.innerHTML = '';
    
    sortedTags.forEach(tag => {
        const checkboxItem = document.createElement('div');
        checkboxItem.className = 'checkbox-item';
        
        checkboxItem.innerHTML = `
            <input type="checkbox" id="tag-${tag}" value="${tag}">
            <label for="tag-${tag}">${tag}</label>
        `;
        
        checkboxItem.querySelector('input').addEventListener('change', applyFilters);
        tagFilters.appendChild(checkboxItem);
    });
}

// Setup reviewer filters
function setupReviewerFilters() {
    const reviewerFilters = document.getElementById('reviewer-filters');
    const sortedReviewers = Array.from(allReviewers).sort();
    
    reviewerFilters.innerHTML = '';
    
    sortedReviewers.forEach(reviewer => {
        const checkboxItem = document.createElement('div');
        checkboxItem.className = 'checkbox-item';
        
        const safeName = reviewer.replace(/[^a-zA-Z0-9]/g, '-');
        
        checkboxItem.innerHTML = `
            <input type="checkbox" id="reviewer-${safeName}" value="${reviewer}">
            <label for="reviewer-${safeName}">${reviewer}</label>
        `;
        
        checkboxItem.querySelector('input').addEventListener('change', applyFilters);
        reviewerFilters.appendChild(checkboxItem);
    });
}

// Apply filters
function applyFilters() {
    const selectedTags = Array.from(document.querySelectorAll('#tag-filters input:checked')).map(cb => cb.value);
    const selectedReviewers = Array.from(document.querySelectorAll('#reviewer-filters input:checked')).map(cb => cb.value);
    const minRating = parseFloat(document.getElementById('rating-filter').value) || 0;
    
    restaurants.forEach((restaurant, index) => {
        const card = document.querySelector(`[data-index="${index}"]`);
        const marker = markers[index];
        
        let show = true;
        
        // Filter by tags
        if (selectedTags.length > 0) {
            const hasSelectedTag = selectedTags.some(tag => restaurant.tags.includes(tag));
            if (!hasSelectedTag) show = false;
        }
        
        // Filter by reviewers
        if (selectedReviewers.length > 0) {
            if (!selectedReviewers.includes(restaurant.reviewer)) show = false;
        }
        
        // Filter by rating
        if (restaurant.rating < minRating) show = false;
        
        // Show/hide card and marker
        if (show) {
            card.classList.remove('hidden');
            map.addLayer(marker);
        } else {
            card.classList.add('hidden');
            map.removeLayer(marker);
        }
    });
}

// Clear all filters
function clearAllFilters() {
    // Clear checkboxes
    document.querySelectorAll('#tag-filters input, #reviewer-filters input').forEach(cb => {
        cb.checked = false;
    });
    
    // Reset rating filter
    document.getElementById('rating-filter').value = '0';
    
    // Show all restaurants
    restaurants.forEach((restaurant, index) => {
        const card = document.querySelector(`[data-index="${index}"]`);
        const marker = markers[index];
        
        card.classList.remove('hidden');
        if (!map.hasLayer(marker)) {
            map.addLayer(marker);
        }
    });
}

// Center map on all restaurants
function centerMapOnRestaurants() {
    if (restaurants.length === 0) return;
    
    const group = new L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.1));
}