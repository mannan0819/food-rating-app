// src/server.ts

import express, { Request, Response, NextFunction } from 'express';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Define Interfaces for Type Safety
interface Restaurant {
    id?: number;
    name: string;
    location?: string;
    created_at?: string;
    updated_at?: string;
}

interface FoodItem {
    id?: number;
    name: string;
    description?: string;
    price?: number;
    restaurant_id: number;
    image_path?: string; // Optional Image Path
    created_at?: string;
    updated_at?: string;
}

interface Review {
    id?: number;
    food_item_id: number;
    rating: number;
    comment?: string;
    image_path?: string; // Optional Image Path
    date?: string;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Declare the database variable with the correct type from 'sqlite'
let db: Database<sqlite3.Database, sqlite3.Statement>;

// Initialize SQLite database
async function initDb() {
    db = await open({
        filename: './food-ratings.db',
        driver: sqlite3.Database
    });

    // Enable Foreign Key Support
    await db.run(`PRAGMA foreign_keys = ON`);

    // Create Restaurants Table
    await db.run(`
        CREATE TABLE IF NOT EXISTS restaurants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            location TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create Food Items Table
    await db.run(`
        CREATE TABLE IF NOT EXISTS food_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            price REAL,
            restaurant_id INTEGER NOT NULL,
            image_path TEXT, -- Optional Image Path
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
        )
    `);

    // Create Reviews Table
    await db.run(`
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            food_item_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
            comment TEXT,
            image_path TEXT, -- Optional Image Path
            date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (food_item_id) REFERENCES food_items(id) ON DELETE CASCADE
        )
    `);

    console.log('Connected to the SQLite database and tables are set up.');
}

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Configure Multer Storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

// File filter to accept only image files
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const filetypes = /jpeg|jpg|png|gif/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (mimetype && extname) {
        return cb(null, true);
    }
    cb(new Error('Only image files are allowed!'));
};

// Initialize Multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Middleware
app.use(express.json());

// Serve static files from the uploads directory
app.use('/uploads', express.static(uploadDir));

// Optional: Enable CORS if your frontend is hosted separately
app.use(cors({
    origin: 'http://your-frontend-domain.com', // Replace with your frontend URL
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

// Async Handler to Catch Errors in Async Routes
const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// -----------------------
// Restaurants Routes
// -----------------------

// Create a new restaurant
app.post('/restaurants', asyncHandler(async (req: Request, res: Response) => {
    const { name, location } = req.body as Restaurant;

    if (!name) {
        return res.status(400).json({ error: 'Restaurant name is required.' });
    }

    const result = await db.run(
        'INSERT INTO restaurants (name, location) VALUES (?, ?)',
        [name, location]
    );

    const newRestaurant: Restaurant = {
        id: result.lastID,
        name,
        location
    };

    res.status(201).json(newRestaurant);
}));

// Get all restaurants
app.get('/restaurants', asyncHandler(async (req: Request, res: Response) => {
    const restaurants: Restaurant[] = await db.all('SELECT * FROM restaurants ORDER BY created_at DESC');
    res.json(restaurants);
}));

// Get a single restaurant by ID
app.get('/restaurants/:id', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const restaurant: Restaurant | undefined = await db.get('SELECT * FROM restaurants WHERE id = ?', [id]);

    if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found.' });
    }

    res.json(restaurant);
}));

// Update a restaurant by ID
app.put('/restaurants/:id', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, location } = req.body as Restaurant;

    const restaurant = await db.get('SELECT * FROM restaurants WHERE id = ?', [id]);

    if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found.' });
    }

    const updatedName = name || restaurant.name;
    const updatedLocation = location || restaurant.location;

    await db.run(
        'UPDATE restaurants SET name = ?, location = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [updatedName, updatedLocation, id]
    );

    const updatedRestaurant: Restaurant = {
        id: Number(id),
        name: updatedName,
        location: updatedLocation
    };

    res.json(updatedRestaurant);
}));

// Delete a restaurant by ID
app.delete('/restaurants/:id', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const restaurant = await db.get('SELECT * FROM restaurants WHERE id = ?', [id]);

    if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant not found.' });
    }

    await db.run('DELETE FROM restaurants WHERE id = ?', [id]);

    res.json({ message: 'Restaurant deleted successfully.' });
}));

// -----------------------
// Food Items Routes
// -----------------------

// Create a new food item with optional image
app.post('/food-items', upload.single('image'), asyncHandler(async (req: Request, res: Response) => {
    const { name, description, price, restaurant_id } = req.body as FoodItem;

    if (!name || !restaurant_id) {
        // Delete uploaded file if validation fails
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ error: 'Food item name and restaurant_id are required.' });
    }

    // Check if the restaurant exists
    const restaurant = await db.get('SELECT * FROM restaurants WHERE id = ?', [restaurant_id]);
    if (!restaurant) {
        // Delete uploaded file if restaurant does not exist
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({ error: 'Restaurant not found.' });
    }

    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await db.run(
        'INSERT INTO food_items (name, description, price, restaurant_id, image_path) VALUES (?, ?, ?, ?, ?)',
        [name, description, price, restaurant_id, imagePath]
    );

    const newFoodItem: FoodItem = {
        id: result.lastID,
        name,
        description,
        price,
        restaurant_id,
        image_path: imagePath || undefined
    };

    res.status(201).json(newFoodItem);
}));

// Get all food items
app.get('/food-items', asyncHandler(async (req: Request, res: Response) => {
    const foodItems: FoodItem[] = await db.all('SELECT * FROM food_items ORDER BY created_at DESC');
    res.json(foodItems);
}));

// Get a single food item by ID
app.get('/food-items/:id', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const foodItem: FoodItem | undefined = await db.get('SELECT * FROM food_items WHERE id = ?', [id]);

    if (!foodItem) {
        return res.status(404).json({ error: 'Food item not found.' });
    }

    res.json(foodItem);
}));

// Update a food item by ID with optional image
app.put('/food-items/:id', upload.single('image'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, description, price, restaurant_id } = req.body as FoodItem;

    const foodItem = await db.get('SELECT * FROM food_items WHERE id = ?', [id]);

    if (!foodItem) {
        // Delete uploaded file if food item does not exist
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({ error: 'Food item not found.' });
    }

    // If restaurant_id is being updated, verify the new restaurant exists
    if (restaurant_id && restaurant_id !== foodItem.restaurant_id) {
        const restaurant = await db.get('SELECT * FROM restaurants WHERE id = ?', [restaurant_id]);
        if (!restaurant) {
            // Delete uploaded file if restaurant does not exist
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(404).json({ error: 'New restaurant not found.' });
        }
    }

    const updatedName = name || foodItem.name;
    const updatedDescription = description || foodItem.description;
    const updatedPrice = price !== undefined ? price : foodItem.price;
    const updatedRestaurantId = restaurant_id || foodItem.restaurant_id;
    let updatedImagePath = foodItem.image_path;

    if (req.file) {
        // Delete old image if exists
        if (foodItem.image_path) {
            const oldImagePath = path.join(__dirname, '..', foodItem.image_path);
            if (fs.existsSync(oldImagePath)) {
                fs.unlinkSync(oldImagePath);
            }
        }
        updatedImagePath = `/uploads/${req.file.filename}`;
    }

    await db.run(
        'UPDATE food_items SET name = ?, description = ?, price = ?, restaurant_id = ?, image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [updatedName, updatedDescription, updatedPrice, updatedRestaurantId, updatedImagePath, id]
    );

    const updatedFoodItem: FoodItem = {
        id: Number(id),
        name: updatedName,
        description: updatedDescription,
        price: updatedPrice,
        restaurant_id: updatedRestaurantId,
        image_path: updatedImagePath || undefined
    };

    res.json(updatedFoodItem);
}));

// Delete a food item by ID
app.delete('/food-items/:id', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const foodItem = await db.get('SELECT * FROM food_items WHERE id = ?', [id]);

    if (!foodItem) {
        return res.status(404).json({ error: 'Food item not found.' });
    }

    // Delete image if exists
    if (foodItem.image_path) {
        const imagePath = path.join(__dirname, '..', foodItem.image_path);
        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
    }

    await db.run('DELETE FROM food_items WHERE id = ?', [id]);

    res.json({ message: 'Food item deleted successfully.' });
}));

// -----------------------
// Reviews Routes
// -----------------------

// Create a new review with optional image
app.post('/reviews', upload.single('image'), asyncHandler(async (req: Request, res: Response) => {
    const { food_item_id, rating, comment } = req.body as Review;

    if (!food_item_id || !rating) {
        // Delete uploaded file if validation fails
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ error: 'food_item_id and rating are required.' });
    }

    if (rating < 1 || rating > 5) {
        // Delete uploaded file if validation fails
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    // Check if the food item exists
    const foodItem = await db.get('SELECT * FROM food_items WHERE id = ?', [food_item_id]);
    if (!foodItem) {
        // Delete uploaded file if food item does not exist
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({ error: 'Food item not found.' });
    }

    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await db.run(
        'INSERT INTO reviews (food_item_id, rating, comment, image_path) VALUES (?, ?, ?, ?)',
        [food_item_id, rating, comment, imagePath]
    );

    const newReview: Review = {
        id: result.lastID,
        food_item_id,
        rating,
        comment,
        image_path: imagePath || undefined
    };

    res.status(201).json(newReview);
}));

// Get all reviews
app.get('/reviews', asyncHandler(async (req: Request, res: Response) => {
    const reviews: Review[] = await db.all('SELECT * FROM reviews ORDER BY date DESC');
    res.json(reviews);
}));

// Get a single review by ID
app.get('/reviews/:id', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const review: Review | undefined = await db.get('SELECT * FROM reviews WHERE id = ?', [id]);

    if (!review) {
        return res.status(404).json({ error: 'Review not found.' });
    }

    res.json(review);
}));

// Update a review by ID with optional image
app.put('/reviews/:id', upload.single('image'), asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { food_item_id, rating, comment } = req.body as Review;

    const review = await db.get('SELECT * FROM reviews WHERE id = ?', [id]);

    if (!review) {
        // Delete uploaded file if review does not exist
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({ error: 'Review not found.' });
    }

    if (rating && (rating < 1 || rating > 5)) {
        // Delete uploaded file if validation fails
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    // If food_item_id is being updated, verify the new food item exists
    if (food_item_id && food_item_id !== review.food_item_id) {
        const foodItem = await db.get('SELECT * FROM food_items WHERE id = ?', [food_item_id]);
        if (!foodItem) {
            // Delete uploaded file if food item does not exist
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(404).json({ error: 'New food item not found.' });
        }
    }

    const updatedFoodItemId = food_item_id || review.food_item_id;
    const updatedRating = rating !== undefined ? rating : review.rating;
    const updatedComment = comment || review.comment;
    let updatedImagePath = review.image_path;

    if (req.file) {
        // Delete old image if exists
        if (review.image_path) {
            const oldImagePath = path.join(__dirname, '..', review.image_path);
            if (fs.existsSync(oldImagePath)) {
                fs.unlinkSync(oldImagePath);
            }
        }
        updatedImagePath = `/uploads/${req.file.filename}`;
    }

    await db.run(
        'UPDATE reviews SET food_item_id = ?, rating = ?, comment = ?, image_path = ?, date = CURRENT_TIMESTAMP WHERE id = ?',
        [updatedFoodItemId, updatedRating, updatedComment, updatedImagePath, id]
    );

    const updatedReview: Review = {
        id: Number(id),
        food_item_id: updatedFoodItemId,
        rating: updatedRating,
        comment: updatedComment,
        image_path: updatedImagePath || undefined
    };

    res.json(updatedReview);
}));

// Delete a review by ID
app.delete('/reviews/:id', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const review = await db.get('SELECT * FROM reviews WHERE id = ?', [id]);

    if (!review) {
        return res.status(404).json({ error: 'Review not found.' });
    }

    // Delete image if exists
    if (review.image_path) {
        const imagePath = path.join(__dirname, '..', review.image_path);
        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
    }

    await db.run('DELETE FROM reviews WHERE id = ?', [id]);

    res.json({ message: 'Review deleted successfully.' });
}));

// -----------------------
// Error Handling Middleware
// -----------------------

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(err.stack);
    if (err instanceof multer.MulterError) {
        // Handle Multer-specific errors
        res.status(400).json({ error: err.message });
        return;
    } else if (err.message === 'Only image files are allowed!') {
        res.status(400).json({ error: err.message });
        return;
    }
    res.status(500).json({ error: 'Something went wrong!' });
});

// -----------------------
// Start Server After Initializing DB
// -----------------------

initDb()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
    })
    .catch((err) => {
        console.error('Failed to initialize the database:', err);
    });
