var http = require('http');

var mongoose = require('mongoose'),
    passport = require('passport'),
    express  = require('express' );
    
var Strategy = require('passport-local').Strategy,
    Schema   = mongoose.Schema;

var app = express();

require('express-helpers')(app);

// === Database and models === 

mongoose.connect('mongodb://' + process.env.IP + '/db'); // ./node_mongodb/mongod &

var User = mongoose.model('User', new Schema({
        email   : String,
        username: String,
        password: String,
        role    : String
    })
);

User.findOne({ username: 'Admin' }).exec(function(error, user) {
    if (!error && !user) {
        user = new User({
            email   : 'admin@example.com',
            username: 'Admin',
            password: '123123',
            role    : 'admin'
        });
        
        user.save();
    }
});

var Comment = new Schema({
    text: String,
    date: Date  ,
    user: { type: Schema.Types.ObjectId, ref: 'User' }
});

var Issue = new Schema({
    ordinal : { type: Number, index: { unique: true, dropDubs: true, sparse: true } },
    title   : String,
    text    : String,
    created : Date  ,
    progress: { type: String, default: 'Open' },
    severity: { type: Number, default: 1      },
    assigned: { type: Schema.Types.ObjectId, ref: 'User' },
    comments: [Comment]
});

var Project = mongoose.model('Project', Schema({
        title : String,
        name  : { type: String, index: { unique: true, dropDubs: true } },
        issues: [Issue],
    })
);

// === Middleware === 

app.use(express.urlencoded  ());
app.use(express.cookieParser());
app.use(express.cookieSession({ secret: 'issues-secret' }));

// === Authentication ===

app.use(passport.initialize());
app.use(passport.session   ());

passport.serializeUser(function(user, done) {
    done(null, user._id);
});

passport.deserializeUser(function (id, done) {
    User.findById(id, done);
});

passport.use(new Strategy(function(username, password, done) {
    User.findOne({ username: username }, function(error, user) {
        if (error) {
            return done(error);
        }
        
        if (!user) {
            return done(null, false, { message: 'Incorrect username.' });
        }
        
        if (user.password != password) {
            return done(null, false, { message: 'Incorrect password.' });
        }
        
        return done(null, user);
    });
}));

// === Utilities ===

var utils = {};

utils.logout = function(request, response) {
    request.logout();
    response.redirect('/account/login');
};

utils.authenticate = function(role) {
    return function(request, response, next) {
        if (request.isAuthenticated() && request.user) {
            if (role instanceof Array) {
                if (role.indexOf(request.user.role) >= 0) {
                    next();
                }
            } else if (typeof role === 'string') {
                if (role === request.user.role) {
                    next();
                }
            } else if (!role) {
                next();
            }
        } else {
            utils.logout(request, response);
        }
    };
};

utils.render = function(view) {
    return function(request, response) {
        response.render(view);
    };
};

// === Settings ===

app.set('view engine', 'ejs');

// === Contoller: Root ===

app.get('/', function(request, response) { response.redirect('/projects'); })

// === Controller: Account ===

app.get('/account/login', utils.render('login'));

app.post('/account/login', passport.authenticate('local', { successRedirect: '/',
                                                            failureRedirect: '/account/login' }));
   
app.get('/account/logout', utils.authenticate(), function(request, response) {
    request.logout();
    response.redirect('/account/login');
});

// === Controller: Projects ===

app.get('/projects', utils.authenticate(), function(request, response) {
    Project.find({}, function (error, projects) {
        response.render('projects', { user: request.user, projects: projects });
    });
});

app.post('/projects', utils.authenticate('admin'), function(request, response) {
    var name    = request.body.title.toLowerCase().replace(/[^\w ]+/g,'').replace(/ +/g,'-'),
        project = new Project({ name: name, title: request.body.title});
        
    project.save(function (error) {
        response.redirect('/projects');
    });
});

app.get('/projects/:name', utils.authenticate(), function(request, response) {
    Project.findOne({ name: request.params.name }).populate('issues.assigned').exec(function(error, project) {
        response.render('project', { user: request.user, project: project});
    });
});

app.get('/projects/:name/delete', utils.authenticate('admin'), function(request, response) {
    Project.remove({ name: request.params.name }).exec(function (error) {
        response.redirect('/projects');
    });
});

// === Controller: Issues ===

// Create
app.post('/projects/:name/issues', utils.authenticate(), function(request, response) {
    Project.findOne({ name: request.params.name }).exec(function(error, project) {
        var ordinal = 0;
        
        project.issues.forEach(function(issue) {
            if (issue.ordinal > ordinal) ordinal = issue.ordinal;
        });
        
        project.issues.push({
            ordinal : ordinal + 1,
            title   : request.body.title,
            created : new Date(),
            assigned: request.user._id,
        });
       
        project.save(function(error) {
            response.redirect('/projects/' + request.params.name);
        });
    });
});

// Read
app.get('/projects/:name/issues/:id', utils.authenticate(), function(request, response) {
   Project.findOne({ name: request.params.name }).populate('issues.assigned').exec(function(error, project) {
       var issue = project.issues.filter(function(i) { return i.ordinal == request.params.id; })[0];
       
       User.find({}).exec(function(error, users) {
           response.render('issue', { user: request.user, users: users, issue: issue, project: project })
       });
   });
});

// Update
app.post('/projects/:name/issues/:id', utils.authenticate(), function(request, response) {
    Project.findOne({ name: request.params.name }).exec(function(error, project) {
        var issue = project.issues.filter(function(i) { return i.ordinal == request.params.id; })[0];
        
        issue.title    = request.body.title   ;
        issue.text     = request.body.text    ;
        issue.progress = request.body.progress;
        issue.severity = request.body.severity;
        
        User.findOne({ name: request.body.assigned }).exec(function(error, user) {
            issue.user = user;
            
            project.save(function(error) {
                response.redirect('/projects/' + request.params.name);
            });
        });
    });
});

// Delete
app.get('/projects/:name/issues/:id/delete', utils.authenticate('admin'), function (request, response) {
    Project.findOne({ name: request.params.name }).exec(function(error, project) {
        project.issues.filter(function(i) { return i.ordinal == request.params.id; })[0].remove();
        
        project.save(function (error) {
            response.redirect('/projects/' + request.params.name);
        });
    });
});

// Comment
app.post('/projects/:name/issues/:id/comment', utils.authenticate(), function(request, response) {
    Project.findOne({ name: request.params.name }).exec(function(error, project) {
        var issue = project.issues.filter(function(i) { return i.ordinal == request.params.id; })[0];
        
        issue.comments.push({ text: request.body.text, user: request.user._id, date: Date.now() });
        
        project.save(function(error) {
            response.redirect('/projects/' + request.params.name + '/issues/' + request.params.id)
        });
    });
});

// === Server ===

http.createServer(app).listen(process.env.PORT, process.env.IP, function () {
    console.log("Issues server is online.");
});
