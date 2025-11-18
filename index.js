// npm install dotenv express-session pg ejs node knex

// Load environment variables from .env file into memory
// Allows you to use process.env
require('dotenv').config();

const express = require("express");

//Needed for the session variable - Stored on the server to hold data
const session = require("express-session");

let path = require("path");

// Allows you to read the body of incoming HTTP requests and makes that data available on req.body
let bodyParser = require("body-parser");

let app = express();

app.set("view engine", "ejs");

const port = process.env.PORT || 3005;

app.use(
    session(
        {
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: false,
    saveUninitialized: false,
        }
    )
);

// connect to database
const knex = require("knex")({
    client: "pg",
    connection: {
        host : process.env.DB_HOST || "localhost",
        user : process.env.DB_USER || "postgres",
        password : process.env.DB_PASSWORD || "admin",
        database : process.env.DB_NAME || "pastimedb",
        port : process.env.DB_PORT || 5432
    }
});

// Tells Express how to read form data sent in the body of a request
app.use(express.urlencoded({extended: true}));

// MIDDLEWARE FOR LOGIN -- Change as needed

// Global authentication middleware - runs on EVERY request
app.use((req, res, next) => {
    // Skip authentication for login routes
    if (req.path === '/login' || req.path === '/logout' || req.path === '/signup') {
        //continue with the request path
        return next();
    }
    
    // Check if user is logged in for all other routes
    if (req.session.isLoggedIn) {
        //notice no return because nothing below it
        next(); // User is logged in, continue
    } 
    else {
        res.render("login", { error_message: "Please log in to access this page" });
    }
});

// HOME PAGE REQUEST

// On home page request
app.get("/", (req, res) => {
    // Check if user is logged in
    if (req.session.isLoggedIn) {        
        res.render("landing");
    } 
    else {
        res.render("login", { error_message: "" });
    }
});

// Route for user to try to log in

// This creates attributes in the session object to keep track of user and if they logged in
app.post("/login", (req, res) => {
    let sName = req.body.email;
    let sPassword = req.body.password;

    knex.select("email", "password")
    .from('users')
    .where("email", sName)
    .andWhere("password", sPassword)
    .then(users => {
      // Check if a user was found with matching username AND password
        if (users.length > 0) {
            req.session.isLoggedIn = true;
                                                                                    // Choose session variables
            req.session.email = sName;
            // On log in go to home page
            res.redirect("/");
        } else {
        // No matching user found
            res.render("login", { error_message: "Invalid login" });
        }
    })
    .catch(err => {
        console.error("Login error:", err);
        res.render("login", { error_message: "Invalid login" });
    });
});

// Logout route
app.get("/logout", (req, res) => {
    // Get rid of the session object
    req.session.destroy((err) => {
        if (err) {
            console.log(err);
        }
        res.redirect("/");
    });
});

app.get("/viewProfile", (req, res) => {
    if (req.session.isLoggedIn) {
        knex("users").where("email", req.session.email).first().then(user => {
            res.render("viewProfile", {user: user})
        })
    }
    else {
        res.render("login", { error_message: "" })
    }
})

app.listen(port, () => {
    console.log("The server is listening");
});