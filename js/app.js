// Configuration
const CONFIG = {
    version: '1.9.8.1',
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
let selectedTags = new Set();
// selectedReviewer removed - now using tags
let currentSort = 'newest';

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.log(`🍔 Bigger Belly Boys v${CONFIG.version} - Loading...`);
    initializeMap();
    setupEventListeners();
    loadRestaurantData();
});

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
        applyFilters();
    });
    
    // Sort filter
    document.getElementById('sort-filter').addEventListener('change', function() {
        currentSort = this.value;
        sortAndDisplayRestaurants();
    });
}

// Lazy loading removed for better user experience

// Load restaurant data from CSV
async function loadRestaurantData() {
    const loadingElement = document.getElementById('loading');
    
    try {
        if (CONFIG.csvUrl === 'PASTE_YOUR_GOOGLE_SHEETS_CSV_URL_HERE') {
            throw new Error('Please update the CSV URL in the CONFIG object');
        }
        
        const response = await fetch(`${CONFIG.csvUrl}&_t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        const parsedData = parseCSV(csvText);
        restaurants = processRestaurantData(parsedData);
        
        if (restaurants.length === 0) {
            throw new Error('No valid restaurant data found');
        }
        
        createMapMarkers();
        sortAndDisplayRestaurants();
        setupFilters();
        centerMapOnCenterOfMass();
        
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
function processRestaurantData(rawData) {
    const requiredFields = ['Restaurant', 'Address', 'Latitude', 'Longitude'];
    
    const validData = rawData.filter((row, index) => {
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
        
        // Validate TikTok Thumbnail URL
        const tikTokThumbnail = row['TikTok Thumbnail'] ? row['TikTok Thumbnail'].trim() : '';
        const validThumbnailUrl = tikTokThumbnail && tikTokThumbnail.startsWith('https://');
        
        const isValid = missingFields.length === 0 && validCoordinates && validThumbnailUrl;
        
        // Debug logging for invalid rows
        if (!isValid) {
            console.log(`🔍 Row ${index + 1} validation failed:`, {
                restaurant: row.Restaurant || 'N/A',
                missingFields: missingFields.length > 0 ? missingFields : 'none',
                coordinates: validCoordinates ? 'valid' : `invalid (lat: ${cleanLat}, lng: ${cleanLng})`,
                thumbnailUrl: validThumbnailUrl ? 'valid' : `invalid (${tikTokThumbnail || 'empty'})`,
                availableColumns: Object.keys(row)
            });
        }
        
        return isValid;
    });
    
    // Debug logging summary
    console.log(`📊 Validation summary: ${validData.length}/${rawData.length} rows valid`);
    if (validData.length === 0) {
        console.error('❌ No valid rows found! Check the debug logs above for validation failures.');
    }
    
    const processedData = validData.map((row, index) => {
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
        
        return {
            reviewer: row.Reviewer ? row.Reviewer.trim() : 'Unknown',
            restaurant: row.Restaurant.trim(),
            tags: tags,
            location: row.Location ? row.Location.trim() : '',
            address: row.Address.trim(),
            googleMapsLink: row['Google Maps Link'] ? row['Google Maps Link'].trim() : '',
            latitude: parseFloat(row.Latitude.toString().replace('@', '')),
            longitude: parseFloat(row.Longitude),
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
        
        // Popup images now load normally
        
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

// Create restaurant cards
function createRestaurantCards(sortedRestaurants = restaurants) {
    const restaurantList = document.getElementById('restaurant-list');
    restaurantList.innerHTML = '';
    
    sortedRestaurants.forEach((restaurant, index) => {
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
}

// Setup filter controls
function setupFilters() {
    setupDynamicRatingSlider();
    console.log(`🔧 Filters ready - ${Array.from(allTags).length} tags available for search`);
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
        applyFilters();
    });
    
    console.log(`🎚️ Rating slider: ${minRating} - ${maxRating}`);
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
                    
                    return matchesTag || matchesReviewer;
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
    
    applyFilters();
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

// Apply filters
function applyFilters() {
    const minRating = parseFloat(document.getElementById('rating-filter').value) || 0;
    
    restaurants.forEach((restaurant, index) => {
        const card = document.querySelector(`[data-index="${index}"]`);
        const marker = markers[index];
        
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
                
                // Clean filtering without debug logs
                
                return matchesTag || matchesReviewer;
            });
            if (!hasAllSelectedTags) show = false;
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
    // Clear selected tags
    selectedTags.clear();
    updateSelectedTagsDisplay();
    
    // Reviewer filtering now handled through tags
    
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
    sortAndDisplayRestaurants();
    
    // Show all restaurants
    restaurants.forEach((restaurant, index) => {
        const card = document.querySelector(`[data-index="${index}"]`);
        const marker = markers[index];
        
        if (card) {
            card.classList.remove('hidden');
        }
        if (!map.hasLayer(marker)) {
            map.addLayer(marker);
        }
    });
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
        
        console.log(`🗺️ Map fitted to show all ${count} restaurants across both coasts`);
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