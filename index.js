/* 
===============================================================================
PasTime — Navigation Guide
===============================================================================

    1. INITIAL SETUP
    2. DATABASE CONNECTION
    3. MIDDLEWARE
    4. LOGIN / LOGOUT
    5. FEED
    6. POSTS
    7. PROFILE
    8. EDIT POSTS
    9. SAVED POSTS
    10. FOLLOW SYSTEM
    11. GROUPS
    12. SEARCH
    13. START SERVER
*/
// ============================================================================
// INITIAL SETUP
// ============================================================================

// npm install dotenv express-session pg ejs knex

require("dotenv").config();
const express = require("express");
const session = require("express-session");
let path = require("path");
let bodyParser = require("body-parser");

const app = express();
app.set("view engine", "ejs");

const port = process.env.PORT || 3000;


// ============================================================================
// DATABASE CONNECTION
// ============================================================================

const knex = require("knex")({
    client: "pg",
    connection: {
        host: process.env.RDS_HOSTNAME || "localhost",
        user: process.env.RDS_USERNAME || "postgres",
        password: process.env.RDS_PASSWORD || "SuperSecretPassword",
        database: process.env.RDS_DB_NAME || "pastime",
        port: process.env.RDS_PORT || 5432,
        ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : false
    }
});


// ============================================================================
// MIDDLEWARE
// ============================================================================

// Parses form submissions
app.use(express.urlencoded({ extended: true }));

// Session setup
app.use(
    session({
        secret: process.env.SESSION_SECRET || "fallback-secret-key",
        resave: false,
        saveUninitialized: false,
    })
);

// Global authentication guard
app.use((req, res, next) => {
    // Allow these paths without being logged in
    if (req.path === "/login" || req.path === "/logout" || req.path === "/signup" || req.path === "/register") {
        return next();
    }

    // If logged in → continue
    if (req.session.isLoggedIn) {
        return next();
    }

    // Otherwise show login page
    res.render("login", { error_message: "Please log in to access this page" });
});


// ============================================================================
// LOGIN / LOGOUT
// ============================================================================

// Home page (login or landing)
app.get("/", (req, res) => {

    // If not logged in → go to login page
    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "" });
    }

    // If logged in → load recent posts for landing page
    knex("posts")
        .join("users as u", "posts.user_id", "u.user_id")
        .leftJoin("groups as g", "posts.group_id", "g.group_id")
        .select(
            "posts.post_id",
            "posts.caption",
            "posts.content",
            "posts.city",
            "posts.state",
            "posts.created_at",
            "u.username",
            "g.group_name"
        )
        .orderBy("posts.created_at", "desc")
        .limit(3)      // only show 3 preview posts
        .then((posts) => {
            res.render("landing", {
                posts: posts
            });
        })
        .catch((err) => {
            console.error("Error loading landing posts:", err.message);

            // Fail gracefully — send NO posts instead of crashing
            res.render("landing", {
                posts: []
            });
        });
});


// Login handler
app.post("/login", (req, res) => {
    let sName = req.body.email;
    let sPassword = req.body.password;

    knex("users")
        .select("email", "password", "user_id")
        .where("email", sName)
        .andWhere("password", sPassword)
        .then((users) => {
            if (users.length > 0) {
                req.session.isLoggedIn = true;
                req.session.email = sName;
                req.session.userID = users[0].user_id
                res.redirect("/");
            } else {
                res.render("login", { error_message: "Invalid login" });
            }
        })
        .catch((err) => {
            console.error("Login error:", err);
            res.render("login", { error_message: "Invalid login" });
        });
});

// Logout
app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) console.log(err);
        res.redirect("/");
    });
});

// Show registration page
app.get("/register", (req, res) => {
    res.render("register", { error_message: "" });
});

// Handle new user registration
app.post("/register", (req, res) => {

    const { username, usr_first_name, usr_last_name, email, password, city, state } = req.body;

    // Validate required fields
    if (!username || !usr_first_name || !usr_last_name || !email || !password || !city || !state) {
        return res.render("register", {
            error_message: "All fields are required."
        });
    }

    // Ensure email and username are unique
    knex("users")
        .where("email", email)
        .orWhere("username", username)
        .first()
        .then(existing => {

            if (existing) {
                return res.render("register", {
                    error_message: "Email or username already in use."
                });
            }

            // Insert new user
            knex("users")
                .insert({
                    username: username,
                    first_name: usr_first_name,
                    last_name: usr_last_name,
                    email: email,
                    password: password,
                    city: city,
                    state: state
                })
                .returning(["user_id", "email"])
                .then(([newUser]) => {

                    // Auto-login after signup
                    req.session.isLoggedIn = true;
                    req.session.email = newUser.email;
                    req.session.userID = newUser.user_id;

                    res.redirect("/");
                })
                .catch(err => {
                    console.error("Error during registration:", err.message);

                    res.render("register", {
                        error_message: "Something went wrong during registration."
                    });
                });
        });
});

// ============================================================================
// FEED
// ============================================================================

// Personalized Feed Route
// Displays posts in the user's city/state and related to their hobbies
app.get("/feed", (req, res) => {
    // Make sure user is logged in
    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to access the feed" });
    }

    // Get logged-in user's session info
    const userEmail = req.session.email;

    // First: get the user's basic info (city, state, user_id)
    knex("users")
        .where("email", userEmail)
        .first()
        .then((user) => {
            // If user not found (shouldn't happen), show error
            if (!user) {
                return res.render("landing", { error_message: "User not found." });
            }

            // Get user's hobbies
            return knex("user_hobbies as uh")
                .join("hobbies as h", "uh.hobby_id", "h.hobby_id")
                .where("uh.user_id", user.user_id)
                .select("h.hobby_name")
                .then((hobbies) => {
                    // Extract hobby names into array
                    const hobbyList = hobbies.map((h) => h.hobby_name);

                    // If no hobbies, display message
                    if (hobbyList.length === 0) {
                        return res.render("feed", {
                            posts: [],
                            hobbies: [],
                            error_message: "Add hobbies to see posts related to your interests."
                        });
                    }

                    // Now query posts based on:
                    // Same city/state
                    // Caption or content contains hobby keywords
                    // Join to users for username
                    knex("posts as p")
                        .join("users as u", "p.user_id", "u.user_id")
                        .leftJoin("groups as g", "p.group_id", "g.group_id")
                        .where(function () {
                            // Condition 1: Same city
                            this.where("p.city", user.city);
                        })
                        .orWhere(function () {
                            // Condition 2: Same state AND hobbies match
                            this.where("p.state", user.state)
                                .andWhere(function () {
                                    hobbyList.forEach((hobby) => {
                                        this.orWhere("p.caption", "ilike", `%${hobby}%`)
                                            .orWhere("p.content", "ilike", `%${hobby}%`);
                                    });
                                });
                        })
                        .select(
                            "p.post_id",
                            "p.caption",
                            "p.content",
                            "p.created_at",
                            "p.contact_method",
                            "u.username",
                            "u.user_id",
                            "g.group_name"
                        )
                        .orderBy("p.created_at", "desc")
                        .then((posts) => {
                            // Render feed page with posts and hobby list
                            res.render("feed", {
                                posts: posts,
                                hobbies: hobbyList,
                                error_message: ""
                            });
                        })
                        .catch((err) => {
                            console.error("Error loading feed posts:", err.message);
                            res.render("feed", {
                                posts: [],
                                hobbies: [],
                                error_message: "Unable to load posts. Please try again."
                            });
                        });
                })
                .catch((err) => {
                    console.error("Error loading hobbies:", err.message);
                    res.render("landing", {
                        error_message: "Unable to load user hobbies."
                    });
                });
        })
        .catch((err) => {
            console.error("Error loading user:", err.message);
            res.render("landing", {
                error_message: "Error loading user information."
            });
        });
});

// Group-Only Feed
// Shows posts only from groups the user is a member of
app.get("/groupFeed", (req, res) => {

    // Must be logged in
    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to view your group feed." });
    }

    // Get current user info
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("feed", {
                    posts: [],
                    hobbies: [],
                    error_message: "User not found."
                });
            }

            // Get group IDs the user belongs to
            knex("group_details")
                .where("user_id", user.user_id)
                .pluck("group_id")
                .then((groupIDs) => {

                    // If user isn't in any groups → show message
                    if (groupIDs.length === 0) {
                        return res.render("feed", {
                            posts: [],
                            hobbies: [],
                            error_message: "You are not a member of any groups yet."
                        });
                    }

                    // Load posts IN those groups
                    knex("posts as p")
                        .join("users as u", "p.user_id", "u.user_id")
                        .join("groups as g", "p.group_id", "g.group_id")
                        .whereIn("p.group_id", groupIDs)
                        .select(
                            "p.post_id",
                            "p.caption",
                            "p.content",
                            "p.created_at",
                            "u.username",
                            "g.group_name"
                        )
                        .orderBy("p.created_at", "desc")
                        .then((posts) => {

                            res.render("feed", {
                                posts: posts,
                                hobbies: [],  // hobbies not relevant here
                                error_message: ""
                            });

                        })
                        .catch((err) => {
                            console.error("Error loading group feed:", err.message);

                            res.render("feed", {
                                posts: [],
                                hobbies: [],
                                error_message: "Unable to load group feed."
                            });
                        });

                });

        })
        .catch((err) => {
            console.error("Error loading user:", err.message);

            res.render("feed", {
                posts: [],
                hobbies: [],
                error_message: "Error retrieving group feed."
            });
        });

});


// ============================================================================
// POSTS
// ============================================================================

// Display the Create Post form
// Loads groups the user belongs to so they can choose where to post
app.get("/makePost", (req, res) => {

    // Make sure user is logged in
    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to create a post." });
    }

    // Load current user's info
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("makePost", {
                    groups: [],
                    error_message: "User not found."
                });
            }

            // Load groups the user is a member of
            knex("group_details as gd")
                .join("groups as g", "gd.group_id", "g.group_id")
                .where("gd.user_id", user.user_id)
                .select("g.group_id", "g.group_name")
                .orderBy("g.group_name", "asc")
                .then((groups) => {

                    res.render("makePost", {
                        groups: groups,
                        error_message: ""
                    });

                })
                .catch((err) => {
                    console.error("Error loading groups:", err.message);

                    res.render("makePost", {
                        groups: [],
                        error_message: "Unable to load your groups."
                    });
                });

        })
        .catch((err) => {
            console.error("Error loading user:", err.message);
            res.render("makePost", {
                groups: [],
                error_message: "Error loading user information."
            });
        });
});


// Handle Create Post submission
app.post("/makePost", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in first." });
    }

    // Grab form fields
    const { caption, content, contact_method, city, state, group_id } = req.body;

    // Validation
    if (!caption || !content || !contact_method || !city || !state) {
        return res.render("makePost", {
            groups: [],
            error_message: "All fields except group are required."
        });
    }

    // Get logged-in user's ID
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("makePost", {
                    groups: [],
                    error_message: "User not found."
                });
            }

            // Insert the post
            knex("posts")
                .insert({
                    user_id: user.user_id,
                    caption: caption,
                    content: content,
                    contact_method: contact_method,
                    city: city,
                    state: state,
                    group_id: group_id || null,  // If no group selected, insert NULL
                    created_at: knex.fn.now()
                })
                .then(() => {
                    res.redirect("/feed");
                })
                .catch((err) => {
                    console.error("Error inserting post:", err.message);

                    res.render("makePost", {
                        groups: [],
                        error_message: "Unable to create post. Please try again."
                    });
                });

        })
        .catch((err) => {
            console.error("Error retrieving user:", err.message);

            res.render("makePost", {
                groups: [],
                error_message: "Error loading user information."
            });
        });
});


// View a single post
// Displays the full post, the creator info, and optional group tag
app.get("/posts/:id", (req, res) => {

    // Make sure user is logged in
    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to view posts." });
    }

    // Grab the post_id from URL
    const postId = req.params.id;

    // Join posts → users → groups to get everything needed
    knex("posts as p")
        .join("users as u", "p.user_id", "u.user_id")
        .leftJoin("groups as g", "p.group_id", "g.group_id")
        .select(
            "p.post_id",
            "p.caption",
            "p.content",
            "p.contact_method",
            "p.city",
            "p.state",
            "p.created_at",
            "u.user_id as poster_id",
            "u.username",
            "g.group_name",
            "g.group_id"
        )
        .where("p.post_id", postId)
        .first()
        .then((post) => {

            // If no post found → error
            if (!post) {
                return res.render("post", {
                    post: null,
                    error_message: "Post not found."
                });
            }

            // Render the Post page with post data
            res.render("post", {
                post: post,
                error_message: ""
            });

        })
        .catch((err) => {
            console.error("Error loading post:", err.message);

            res.render("post", {
                post: null,
                error_message: "Unable to load post. Please try again."
            });
        });
});

// View all posts created by a specific user
app.get("/userPosts/:id", (req, res) => {

    // Ensure user is logged in
    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to view posts." });
    }

    const userId = req.params.id;

    // Load the user's basic info
    knex("users")
        .where("user_id", userId)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("userPosts", {
                    posts: [],
                    user: null,
                    currentUserID: req.session.userID, 
                    error_message: "User not found."
                });
            }

            // Load posts created by this user
            knex("posts as p")
                .leftJoin("groups as g", "p.group_id", "g.group_id")
                .where("p.user_id", userId)
                .select(
                    "p.post_id",
                    "p.caption",
                    "p.content",
                    "p.created_at",
                    "g.group_name"
                )
                .orderBy("p.created_at", "desc")
                .then((posts) => {

                    res.render("userPosts", {
                        posts: posts,
                        user: user,
                        currentUserID: req.session.userID, 
                        error_message: ""
                    });

                })
                .catch((err) => {
                    console.error("Error loading user's posts:", err.message);

                    res.render("userPosts", {
                        posts: [],
                        user: user,
                        currentUserID: req.session.userID, 
                        error_message: "Unable to load this user's posts."
                    });
                });

        })
        .catch((err) => {
            console.error("Error loading user:", err.message);

            res.render("userPosts", {
                posts: [],
                user: null,
                currentUserID: req.session.userID, 
                error_message: "Error loading user information."
            });
        });
});

app.post("/posts/:id/delete", (req, res) => {
    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in." });
    }

    const postId = req.params.id;
    const currentUserID = req.session.userID;

    // Check ownership
    knex("posts")
        .where("post_id", postId)
        .first()
        .then((post) => {
            if (!post) {
                return res.render("post", {
                    post: null,
                    error_message: "Post not found."
                });
            }

            if (post.user_id !== currentUserID) {
                return res.render("post", {
                    post: post,
                    error_message: "You can only delete your own posts."
                });
            }

            // Authorized → delete
            return knex("posts")
                .where("post_id", postId)
                .del()
                .then(() => res.redirect("/userPosts/" + currentUserID));
        })
        .catch((err) => {
            console.error("Delete error:", err.message);
            res.render("post", {
                post: null,
                error_message: "Unable to delete post."
            });
        });
});


// ============================================================================
// PROFILE
// ============================================================================

app.get("/viewProfile", (req, res) => {
    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "" });
    }
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {
            res.render("profile", {
                user: user,
                isFollowing: false,
                isOwnProfile: true,
                error_message: ""
            });
        });
});


// Display the Edit Hobbies page
app.get("/editHobbies", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to edit your hobbies." });
    }

    // Find logged-in user
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("editHobbies", {
                    hobbies: [],
                    error_message: "User not found."
                });
            }

            // Load user's hobbies
            knex("user_hobbies as uh")
                .join("hobbies as h", "uh.hobby_id", "h.hobby_id")
                .where("uh.user_id", user.user_id)
                .select("h.hobby_id", "h.hobby_name")
                .orderBy("h.hobby_name", "asc")
                .then((hobbies) => {

                    res.render("editHobbies", {
                        hobbies: hobbies,
                        error_message: ""
                    });

                })
                .catch((err) => {
                    console.error("Error loading hobbies:", err.message);

                    res.render("editHobbies", {
                        hobbies: [],
                        error_message: "Unable to load your hobbies."
                    });
                });

        })
        .catch((err) => {
            console.error("Error loading user:", err.message);

            res.render("editHobbies", {
                hobbies: [],
                error_message: "Error loading user information."
            });
        });
});

// Add a new hobby for the user
app.post("/editHobbies/add", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to edit hobbies." });
    }

    const hobbyName = req.body.hobby_name;

    if (!hobbyName || hobbyName.trim() === "") {
        return res.redirect("/editHobbies");
    }

    // Find the logged-in user
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.redirect("/editHobbies");
            }

            // Check if the hobby already exists (case-insensitive)
            knex("hobbies")
                .whereRaw("LOWER(hobby_name) = LOWER(?)", [hobbyName])
                .first()
                .then((existingHobby) => {

                    if (existingHobby) {

                        // Hobby exists → link it to the user
                        knex("user_hobbies")
                            .insert({
                                user_id: user.user_id,
                                hobby_id: existingHobby.hobby_id
                            })
                            .then(() => res.redirect("/editHobbies"))
                            .catch((err) => {

                                // If hobby already linked, ignore duplicate
                                if (err.message.includes("duplicate")) {
                                    return res.redirect("/editHobbies");
                                }

                                console.error("Error linking hobby:", err.message);
                                return res.redirect("/editHobbies");
                            });

                    } else {

                        // Hobby doesn't exist → create it, then link
                        knex("hobbies")
                            .insert({ hobby_name: hobbyName })
                            .returning("hobby_id")
                            .then(([newHobby]) => {

                                knex("user_hobbies")
                                    .insert({
                                        user_id: user.user_id,
                                        hobby_id: newHobby.hobby_id
                                    })
                                    .then(() => res.redirect("/editHobbies"));
                            });
                    }
                });
        });
});

// Remove a hobby from the user
app.post("/editHobbies/delete/:hobbyId", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to edit hobbies." });
    }

    const hobbyId = req.params.hobbyId;

    // Find logged-in user
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.redirect("/editHobbies");
            }

            // Delete the row from user_hobbies
            knex("user_hobbies")
                .where({
                    user_id: user.user_id,
                    hobby_id: hobbyId
                })
                .del()
                .then(() => res.redirect("/editHobbies"))
                .catch((err) => {
                    console.error("Error removing hobby:", err.message);
                    res.redirect("/editHobbies");
                });
        });
});

// Public profile page for any user
app.get("/profile/:id", (req, res) => {

    // Ensure logged in
    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to view profiles." });
    }

    const profileId = req.params.id;

    // Find logged-in user
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((currentUser) => {

            if (!currentUser) {
                return res.render("profile", {
                    user: null,
                    isFollowing: false,
                    isOwnProfile: false,
                    error_message: "User not found."
                });
            }

            // Check if viewing own profile
            const isOwnProfile = (currentUser.user_id == profileId);

            // Load profile user
            knex("users")
                .where("user_id", profileId)
                .first()
                .then((profileUser) => {

                    if (!profileUser) {
                        return res.render("profile", {
                            user: null,
                            isFollowing: false,
                            isOwnProfile: false,
                            error_message: "User not found."
                        });
                    }

                    // If it's your own profile, no follow/unfollow
                    if (isOwnProfile) {
                        return res.render("profile", {
                            user: profileUser,
                            isFollowing: false,
                            isOwnProfile: true,
                            error_message: ""
                        });
                    }

                    // Check if current user follows this user
                    knex("friends")
                        .where({
                            user_id: currentUser.user_id,
                            friend_id: profileId
                        })
                        .first()
                        .then((relationship) => {

                            const isFollowing = relationship ? true : false;

                            res.render("profile", {
                                user: profileUser,
                                isFollowing: isFollowing,
                                isOwnProfile: false,
                                error_message: ""
                            });

                        });

                });

        });
});

// ============================================================================
// EDIT POSTS
// ============================================================================

// Show Edit Post Page
app.get("/posts/:id/edit", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to edit posts." });
    }

    const postId = req.params.id;

    knex("posts as p")
        .where("p.post_id", postId)
        .first()
        .then((post) => {

            if (!post) {
                return res.render("post", {
                    post: null,
                    error_message: "Post not found."
                });
            }

            // Ensure the logged-in user owns this post
            if (post.user_id !== req.session.userID) {
                return res.render("post", {
                    post: post,
                    error_message: "You can only edit your own posts."
                });
            }

            // Load groups the user belongs to for dropdown
            knex("group_details as gd")
                .join("groups as g", "gd.group_id", "g.group_id")
                .where("gd.user_id", req.session.userID)
                .select("g.group_id", "g.group_name")
                .orderBy("g.group_name", "asc")
                .then((groups) => {

                    res.render("editPost", {
                        post: post,
                        groups: groups,
                        error_message: ""
                    });

                });

        })
        .catch((err) => {
            console.error("Error loading post for edit:", err.message);
            res.render("post", {
                post: null,
                error_message: "Unable to load post for editing."
            });
        });
});

// Handle Edit Post Submission
app.post("/posts/:id/edit", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in." });
    }

    const postId = req.params.id;
    const { caption, content, contact_method, city, state, group_id } = req.body;

    // Validate required fields
    if (!caption || !content || !contact_method || !city || !state) {
        return res.render("editPost", {
            post: { post_id: postId, caption, content, contact_method, city, state, group_id },
            groups: [],
            error_message: "All fields except group are required."
        });
    }

    // Ensure the user owns this post
    knex("posts")
        .where("post_id", postId)
        .first()
        .then((post) => {

            if (!post) {
                return res.render("post", {
                    post: null,
                    error_message: "Post not found."
                });
            }

            if (post.user_id !== req.session.userID) {
                return res.render("post", {
                    post: post,
                    error_message: "You can only edit your own posts."
                });
            }

            // Update the post
            knex("posts")
                .where("post_id", postId)
                .update({
                    caption: caption,
                    content: content,
                    contact_method: contact_method,
                    city: city,
                    state: state,
                    group_id: group_id || null
                })
                .then(() => {
                    res.redirect("/posts/" + postId);
                })
                .catch((err) => {
                    console.error("Error updating post:", err.message);
                    res.render("editPost", {
                        post: post,
                        groups: [],
                        error_message: "Unable to update post."
                    });
                });

        })
        .catch((err) => {
            console.error("Error loading post:", err.message);
            res.render("post", {
                post: null,
                error_message: "Could not verify post ownership."
            });
        });
});

// ============================================================================
// SAVED POSTS
// ============================================================================

// Save a post for the logged-in user
app.post("/posts/:id/save", (req, res) => {

    // Check user login
    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to save posts." });
    }

    const postId = req.params.id;

    // Get logged-in user's ID
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("post", {
                    post: null,
                    error_message: "User not found."
                });
            }

            // Attempt to insert into saved_posts
            knex("saved_posts")
                .insert({
                    user_id: user.user_id,
                    post_id: postId
                })
                .then(() => {
                    res.redirect(`/posts/${postId}`);
                })
                .catch((err) => {

                    // If already saved (unique constraint)
                    if (err.message.includes("duplicate")) {
                        return res.redirect(`/posts/${postId}`);
                    }

                    console.error("Error saving post:", err.message);

                    res.render("post", {
                        post: null,
                        error_message: "Unable to save post."
                    });
                });
        })
        .catch((err) => {
            console.error("Error retrieving user:", err.message);
            res.render("post", {
                post: null,
                error_message: "Error loading user information."
            });
        });
});

// Unsave a previously saved post
app.post("/posts/:id/unsave", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in." });
    }

    const postId = req.params.id;

    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("post", {
                    post: null,
                    error_message: "User not found."
                });
            }

            // Delete the saved post entry
            knex("saved_posts")
                .where({
                    user_id: user.user_id,
                    post_id: postId
                })
                .del()
                .then(() => {
                    res.redirect(`/posts/${postId}`);
                })
                .catch((err) => {
                    console.error("Error unsaving post:", err.message);
                    res.render("post", {
                        post: null,
                        error_message: "Unable to unsave post."
                    });
                });

        })
        .catch((err) => {
            console.error("User lookup error:", err.message);
            res.render("post", {
                post: null,
                error_message: "Error retrieving user information."
            });
        });
});

// Display all saved posts for the logged-in user
app.get("/saved", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to view saved posts." });
    }

    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("saved", {
                    posts: [],
                    error_message: "User not found."
                });
            }

            knex("saved_posts as sp")
                .join("posts as p", "sp.post_id", "p.post_id")
                .join("users as u", "p.user_id", "u.user_id")
                .leftJoin("groups as g", "p.group_id", "g.group_id")
                .where("sp.user_id", user.user_id)
                .select(
                    "p.post_id",
                    "p.caption",
                    "p.content",
                    "p.created_at",
                    "u.username",
                    "g.group_name"
                )
                .orderBy("p.created_at", "desc")
                .then((posts) => {
                    res.render("saved", {
                        posts: posts,
                        error_message: ""
                    });
                })
                .catch((err) => {
                    console.error("Error loading saved posts:", err.message);

                    res.render("saved", {
                        posts: [],
                        error_message: "Unable to load saved posts."
                    });
                });
        })
        .catch((err) => {
            console.error("Error retrieving user:", err.message);
            res.render("saved", {
                posts: [],
                error_message: "Error loading saved posts."
            });
        });
});


// ============================================================================
// FOLLOW SYSTEM
// ============================================================================

// Follow a user
app.post("/follow/:id", (req, res) => {

    // Ensure user is logged in
    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to follow users." });
    }

    const friendId = req.params.id;

    // First get logged-in user's ID
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("profile", {
                    user: null,
                    error_message: "User not found."
                });
            }

            // Insert into friends table
            knex("friends")
                .insert({
                    user_id: user.user_id,
                    friend_id: friendId
                })
                .then(() => {
                    res.redirect("/profile/" + friendId);
                })
                .catch((err) => {

                    // Duplicate follow → just redirect normally
                    if (err.message.includes("duplicate")) {
                        return res.redirect("/profile/" + friendId);
                    }

                    console.error("Error following user:", err.message);

                    res.render("profile", {
                        user: null,
                        error_message: "Unable to follow this user."
                    });
                });
        })
        .catch((err) => {
            console.error("Error finding logged-in user:", err.message);
            res.render("profile", {
                user: null,
                error_message: "Error loading user information."
            });
        });
});

// Unfollow a user
app.post("/unfollow/:id", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to unfollow users." });
    }

    const friendId = req.params.id;

    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("profile", {
                    user: null,
                    error_message: "User not found."
                });
            }

            // Delete relationship
            knex("friends")
                .where({
                    user_id: user.user_id,
                    friend_id: friendId
                })
                .del()
                .then(() => {
                    res.redirect("/profile/" + friendId);
                })
                .catch((err) => {
                    console.error("Error unfollowing user:", err.message);
                    res.render("profile", {
                        user: null,
                        error_message: "Unable to unfollow this user."
                    });
                });

        })
        .catch((err) => {
            console.error("Error finding user:", err.message);
            res.render("profile", {
                user: null,
                error_message: "Error loading user information."
            });
        });
});

// Show list of users the logged-in user is following
app.get("/friends", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to view your follows." });
    }

    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("displayMany", {
                    users: [],
                    error_message: "User not found."
                });
            }

            // Join friends → users to show the people they follow
            knex("friends as f")
                .join("users as u", "f.friend_id", "u.user_id")
                .where("f.user_id", user.user_id)
                .select("u.user_id", "u.username", "u.city", "u.state")
                .then((friends) => {

                    res.render("friends", {
                        friends: friends,
                        error_message: ""
                    });

                })
                .catch((err) => {
                    console.error("Error loading friends:", err.message);

                    res.render("friends", {
                        friends: [],
                        error_message: "Unable to load your follows."
                    });
                });
        })
        .catch((err) => {
            console.error("Error retrieving user:", err.message);
            res.render("friends", {
                friends: [],
                error_message: "Error loading user information."
            });
        });
});

// Friends feed: posts ONLY from followed users
app.get("/friendsFeed", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to view your friends feed." });
    }

    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("feed", {
                    posts: [],
                    error_message: "User not found."
                });
            }

            knex("friends")
                .where("user_id", user.user_id)
                .pluck("friend_id")       // get list of IDs
                .then((friendIDs) => {

                    if (friendIDs.length === 0) {
                        return res.render("feed", {
                            posts: [],
                            error_message: "You are not following anyone yet."
                        });
                    }

                    knex("posts as p")
                        .join("users as u", "p.user_id", "u.user_id")
                        .leftJoin("groups as g", "p.group_id", "g.group_id")
                        .whereIn("p.user_id", friendIDs)
                        .select(
                            "p.post_id",
                            "p.caption",
                            "p.content",
                            "p.created_at",
                            "u.username",
                            "g.group_name"
                        )
                        .orderBy("p.created_at", "desc")
                        .then((posts) => {
                            res.render("feed", {
                                posts: posts,
                                error_message: ""
                            });
                        })
                        .catch((err) => {
                            console.error("Error loading friends feed:", err.message);

                            res.render("feed", {
                                posts: [],
                                error_message: "Unable to load friends feed."
                            });
                        });

                });
        })
        .catch((err) => {
            console.error("Error loading user:", err.message);
            res.render("feed", {
                posts: [],
                error_message: "Error retrieving friends feed."
            });
        });
});


// ============================================================================
// GROUPS
// ============================================================================

// Display all groups
app.get("/groups", (req, res) => {

    // Must be logged in
    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to view groups." });
    }

    // Get all groups and their owners
    knex("groups as g")
        .join("users as u", "g.group_owner", "u.user_id")
        .select(
            "g.group_id",
            "g.group_name",
            "g.group_description",
            "u.username as owner_name"
        )
        .orderBy("g.group_name", "asc")
        .then((groups) => {
            res.render("groups", {
                groups: groups,
                error_message: ""
            });
        })
        .catch((err) => {
            console.error("Error loading groups:", err.message);
            res.render("groups", {
                groups: [],
                error_message: "Unable to load groups."
            });
        });
});

// View a single group page
// Shows group info + posts within the group
app.get("/groups/:id", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to view groups." });
    }

    const groupId = req.params.id;

    // Get group info
    knex("groups as g")
        .join("users as u", "g.group_owner", "u.user_id")
        .select(
            "g.group_id",
            "g.group_name",
            "g.group_description",
            "u.username as owner_name",
            "u.user_id as owner_id"
        )
        .where("g.group_id", groupId)
        .first()
        .then((group) => {

            if (!group) {
                return res.render("groupPage", {
                    group: null,
                    posts: [],
                    isMember: false,
                    error_message: "Group not found."
                });
            }

            // Find logged-in user
            knex("users")
                .where("email", req.session.email)
                .first()
                .then((currentUser) => {

                    if (!currentUser) {
                        return res.render("groupPage", {
                            group: group,
                            posts: [],
                            isMember: false,
                            error_message: "User not found."
                        });
                    }

                    const currentUserID = currentUser.user_id;

                    // Check if current user is a member
                    knex("group_details")
                        .where({
                            group_id: groupId,
                            user_id: currentUser.user_id
                        })
                        .first()
                        .then((membership) => {
                            const isMember = membership ? true : false;

                            // Fetch posts belonging to this group
                            knex("posts as p")
                                .join("users as u", "p.user_id", "u.user_id")
                                .where("p.group_id", groupId)
                                .select(
                                    "p.post_id",
                                    "p.caption",
                                    "p.content",
                                    "p.created_at",
                                    "u.username",
                                    "u.user_id"
                                )
                                .orderBy("p.created_at", "desc")
                                .then((posts) => {

                                    res.render("groupPage", {
                                        group: group,
                                        posts: posts,
                                        isMember: isMember,
                                        currentUserID: currentUserID,
                                        error_message: ""
                                    });

                                })
                                .catch((err) => {
                                    console.error("Error loading group posts:", err.message);
                                    res.render("groupPage", {
                                        group: group,
                                        posts: [],
                                        isMember: isMember,
                                        error_message: "Unable to load group posts."
                                    });
                                });

                        });

                });

        })
        .catch((err) => {
            console.error("Error loading group:", err.message);
            res.render("groupPage", {
                group: null,
                posts: [],
                isMember: false,
                error_message: "Unable to load group information."
            });
        });
});


// Create a new group
app.post("/groups/create", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to create a group." });
    }

    const { group_name, group_description } = req.body;

    // Validation
    if (!group_name || !group_description) {
        return res.render("groups", {
            groups: [],
            error_message: "Group name and description are required."
        });
    }

    // Find logged-in user
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("groups", {
                    groups: [],
                    error_message: "User not found."
                });
            }

            // Insert the new group
            knex("groups")
                .insert({
                    group_name: group_name,
                    group_description: group_description,
                    group_owner: user.user_id
                })
                .then(() => {
                    res.redirect("/groups");
                })
                .catch((err) => {
                    console.error("Error creating group:", err.message);
                    res.render("groups", {
                        groups: [],
                        error_message: "Unable to create group."
                    });
                });

        });
});

// Join a group
app.post("/groups/:id/join", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to join groups." });
    }

    const groupId = req.params.id;

    // Get logged-in user's ID
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("groupPage", {
                    group: null,
                    posts: [],
                    error_message: "User not found."
                });
            }

            // Insert into group_details (user_id + group_id)
            knex("group_details")
                .insert({
                    group_id: groupId,
                    user_id: user.user_id
                })
                .then(() => {
                    res.redirect("/groups/" + groupId);
                })
                .catch((err) => {

                    // Duplicate join attempt = allowed, just redirect normally
                    if (err.message.includes("duplicate")) {
                        return res.redirect("/groups/" + groupId);
                    }

                    console.error("Error joining group:", err.message);

                    res.render("groupPage", {
                        group: null,
                        posts: [],
                        error_message: "Unable to join group."
                    });
                });

        })
        .catch((err) => {
            console.error("Error finding user:", err.message);
            res.render("groupPage", {
                group: null,
                posts: [],
                error_message: "Error loading user information."
            });
        });
});

// Leave a group
app.post("/groups/:id/leave", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to leave groups." });
    }

    const groupId = req.params.id;

    // Get logged-in user's ID
    knex("users")
        .where("email", req.session.email)
        .first()
        .then((user) => {

            if (!user) {
                return res.render("groupPage", {
                    group: null,
                    posts: [],
                    error_message: "User not found."
                });
            }

            // Load group info to check owner
            knex("groups")
                .where("group_id", groupId)
                .first()
                .then((group) => {

                    if (!group) {
                        return res.render("groupPage", {
                            group: null,
                            posts: [],
                            error_message: "Group not found."
                        });
                    }

                    // Prevent owner from leaving their own group
                    if (group.group_owner === user.user_id) {
                        return res.render("groupPage", {
                            group: group,
                            posts: [],
                            isMember: true,
                            error_message: "Group owners cannot leave their own group."
                        });
                    }

                    // Otherwise, allow leaving
                    knex("group_details")
                        .where({
                            group_id: groupId,
                            user_id: user.user_id
                        })
                        .del()
                        .then(() => {
                            res.redirect("/groups/" + groupId);
                        })
                        .catch((err) => {
                            console.error("Error leaving group:", err.message);

                            res.render("groupPage", {
                                group: group,
                                posts: [],
                                error_message: "Unable to leave group."
                            });
                        });

                });

        })
        .catch((err) => {
            console.error("User lookup error:", err.message);
            res.render("groupPage", {
                group: null,
                posts: [],
                error_message: "Error loading user information."
            });
        });

});


// Group owner removes a post from the group
app.post("/groups/:groupId/removePost/:postId", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in." });
    }

    const groupId = req.params.groupId;
    const postId = req.params.postId;

    // First: Get the group and verify the owner
    knex("groups")
        .where("group_id", groupId)
        .first()
        .then((group) => {

            if (!group) {
                return res.render("groupPage", {
                    group: null,
                    posts: [],
                    isMember: false,
                    error_message: "Group not found."
                });
            }

            // Get logged-in user
            knex("users")
                .where("email", req.session.email)
                .first()
                .then((user) => {

                    if (!user) {
                        return res.render("groupPage", {
                            group: group,
                            posts: [],
                            isMember: false,
                            error_message: "User not found."
                        });
                    }

                    // Check if user is the owner
                    if (group.group_owner !== user.user_id) {
                        return res.render("groupPage", {
                            group: group,
                            posts: [],
                            isMember: false,
                            error_message: "Only the group owner can remove posts."
                        });
                    }

                    // Remove the post FROM THIS GROUP
                    // We do NOT delete the post entirely — just set group_id to NULL.
                    knex("posts")
                        .where("post_id", postId)
                        .update({ group_id: null })
                        .then(() => {
                            res.redirect("/groups/" + groupId);
                        })
                        .catch((err) => {
                            console.error("Error removing post from group:", err.message);

                            res.render("groupPage", {
                                group: group,
                                posts: [],
                                isMember: true,
                                error_message: "Unable to remove post from group."
                            });
                        });
                });

        })
        .catch((err) => {
            console.error("Group lookup error:", err.message);

            res.render("groupPage", {
                group: null,
                posts: [],
                isMember: false,
                error_message: "Failed to load group information."
            });
        });

});


// ============================================================================
// SEARCH
// ============================================================================

// Search page
// Displays a simple search input form
app.get("/search", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to use search." });
    }

    res.render("search", { error_message: "" });
});

// Search results page
// Shows matching posts, users, and groups
app.get("/search/results", (req, res) => {

    if (!req.session.isLoggedIn) {
        return res.render("login", { error_message: "Please log in to search." });
    }

    const query = req.query.query;

    if (!query || query.trim() === "") {
        return res.render("searchResults", {
            posts: [],
            users: [],
            groups: [],
            search_query: "",
            error_message: "Please enter a search term."
        });
    }

    const searchTerm = `%${query}%`;

    // 1. Search posts
    const postQuery = knex("posts as p")
        .join("users as u", "p.user_id", "u.user_id")
        .leftJoin("groups as g", "p.group_id", "g.group_id")
        .where("p.caption", "ilike", searchTerm)
        .orWhere("p.content", "ilike", searchTerm)
        .select(
            "p.post_id",
            "p.caption",
            "p.content",
            "p.created_at",
            "u.username",
            "g.group_name"
        )
        .orderBy("p.created_at", "desc");

    // 2. Search users
    const userQuery = knex("users")
        .where("username", "ilike", searchTerm)
        .select("user_id", "username", "city", "state");

    // 3. Search groups
    const groupQuery = knex("groups")
        .where("group_name", "ilike", searchTerm)
        .orWhere("group_description", "ilike", searchTerm)
        .select("group_id", "group_name", "group_description");

    // Run all 3 searches
    Promise.all([postQuery, userQuery, groupQuery])
        .then(([posts, users, groups]) => {
            res.render("searchResults", {
                posts: posts,
                users: users,
                groups: groups,
                search_query: query,
                error_message: ""
            });
        })
        .catch((err) => {
            console.error("Search error:", err.message);

            res.render("searchResults", {
                posts: [],
                users: [],
                groups: [],
                search_query: query,
                error_message: "Error performing search."
            });
        });

});


// ============================================================================
// START SERVER
// ============================================================================

app.listen(port, () => {
    console.log("The server is listening");
});
