"use strict"

/*******************************************************************************
 *
 * GAME WORLD
 *
 * We inherit from a Phaser.js game element and provide additional methods.
 * Let's not over-engineer it: we simply add some methods and attributes to the
 * global *game* object.
 *
 * The game's mainloop is the mainloop of the application. We can register
 * events by
 *
 *******************************************************************************
 */
// Game element
;
var WIDTH = 1000;
var HEIGHT = 700;

// Forces and brownian dynamics
var BROWNIAN_STRENGTH = 1200;
var LINEAR_DAMPING = 0.3;
var ANGULAR_DAMPING = 0.1;
var DRIFT_VELOCITY = 50;
var DRIFT_DAMPING = 7;
var SPRING_CONSTANT = 200;

// Separation force
var SEPARATION_POINT = WIDTH / 2;
var MIGRATION_PROBABILITY = 1.0;
var MIGRATION_DELTA_SPEED = 50;

// Biological parameters
var MAX_DENSITY = 100;
var FITNESS_EXPONENT = 1;
var MATING_DURATION = 40;
var MUTATION_RATE_A = 0;
var MUTATION_RATE_B = 0;
var LINKAGE = 0;
var OFFSPRING = 1;
var MUTATION_GROUP_SIZE = 5;
var ALLELE_FREQS = {
    a: [0.5, 0.5, 0],
    b: [0.5, 0.5, 0]
};

// Plots and UI
var PLOT_UPDATE_INTERVAL = 100;
var TEMPLATES = {};

var game = new Phaser.Game(WIDTH, HEIGHT, Phaser.AUTO, 'game-canvas', { preload: preload, create: create, update: update }, true);

// Game public attributes

// Game methods
function preload() {
    for (var i = 1; i <= 3; i++) {
        for (var j = i; j <= 3; j++) {
            for (var m = 1; m <= 3; m++) {
                for (var n = m; n <= 3; n++) {
                    var code = i.toString() + j.toString() + m.toString() + n.toString();
                    game.load.image('f' + code, 'assets/f' + code + ".png");
                    game.load.image('m' + code, 'assets/m' + code + ".png");
                }
            }
        }
    }
    game.load.image('sepline', 'assets/separator.png');
}

function create() {
    // Prepare the canvas element
    var canvas = document.getElementById('game-canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    //  We use the P2 physics engine in order to have polygon rotations.
    game.physics.startSystem(Phaser.Physics.P2JS);
    game.physics.p2.setImpactEvents(true);
    game.physics.p2.restitution = 1;

    // Add division
    game.division = game.add.sprite(SEPARATION_POINT, HEIGHT / 2, 'sepline');
    game.division.scale.setTo(1, 1);
    game.physics.p2.enable(game.division);
    game.division.body.kinematic = true;
    game.physics.p2.world.on('preSolve', onPresolve);

    // Add new cells
    game.cells = [];
    for (var i = 0; i < MAX_DENSITY; i++) {
        game.cells.push(newCell());
    }

    // Additional attributes
    game._frames_per_step = 1;
    game._frame_no = 0;
    game._time = 0;
    game._next_plots_update = 0;
    game._next_stats_update = 0;
    game._next_sliders_update = 0;

    game._framerate_multiplier = 1;
    game._brownian_force_multiplier = 1;

    // Add UI elements
    ui_create();

    // Update statistics
    stats.update();
}

function update() {
    // Update simulation state (Cells are automatically updated using their
    // update() method.
    game._frame_no++;

    // Update forces manually
    // TODO: this is not working. We are only controlling the frame rate
    //       parameter in order to set the speed of simulation.
    //       This is potentially unstable.
    if (!game.paused) {
        game.prepare_frame();
        if (game._frames_per_step > 1) {
            for (var i = 0; i < game._frames_per_step - 1; i++) {
                game.physics.p2.update();
                game.prepare_frame();
            }
        }
    }

    // Update division
    game.division.body.velocity.x = -1.0 * (game.division.position.x - SEPARATION_POINT);

    // Update UI
    if (game._time >= game._next_sliders_update) {
        game._next_sliders_update += 0.1;
        ui_update_sliders();
    }

    if (game._time >= game._next_stats_update) {
        game._next_stats_update += 0.33;
        stats.update();
    }

    if (game._time > game._next_plots_update) {
        game._next_plots_update += 0.5;
        plots.update();
    }
}

/**
 * Kills elements in excess compared to the maximum supported density.
 */
game._split = function () {
    var left = [],
        right = [];
    for (var cell of game.cells) {
        if (cell.is_left()) {
            left.push(cell);
        } else {
            right.push(cell);
        }
    }
    return { left: left, right: right };
};

game.kill_excess = function () {
    // Split populations
    var split = game._split();
    var left = split.left;
    var right = split.right;

    // Reach desired density
    var area = SEPARATION_POINT / WIDTH;
    var density = left.length / area;
    while (density > MAX_DENSITY && left.length > 2) {
        game._kill_roullete(left);
        density = left.length / area;
    }

    area = (WIDTH - SEPARATION_POINT) / WIDTH;
    density = right.length / area;
    while (density > MAX_DENSITY && right.length > 2) {
        game._kill_roullete(right);
        density = right.length / area;
    }
};

game._kill_roullete = function (L) {
    var cum_fit = [];
    var S = 0;

    for (var cell of L) {
        S += 1 / (Math.pow(cell.fitness, FITNESS_EXPONENT) + 1e-6);
        cum_fit.push(S);
    }

    var thresh = Math.random() * S;
    var i = 0;
    while (cum_fit[i] < thresh) {
        i += 1;
    }

    L[i].destroy();
    L.splice(i, 1);
};

/**
 * Prepare forces for the custom physics interactions
 */
game.prepare_frame = function () {
    game.kill_excess();

    for (var cell of this.cells) {
        cell.prepare_frame();
    }
    this._time += this._framerate_multiplier / 60;
};

/**
 *  New mutant individual --- This introduces A3 or B3 into some part of the population
 */
game.new_mutation = {};

game.new_mutation._add_new = function (gene, pos) {
    var cell = newCell({ pos: pos });
    cell.code[0][gene] = 2; // force one gene to be the 3rd allele
    game.cells.push(cell);
    return cell;
};

game.new_mutation.left = function (gene) {
    var L = game._split().left;
    for (var i = 0; i < MUTATION_GROUP_SIZE; i++) game._kill_roullete(L);

    for (i = 0; i < MUTATION_GROUP_SIZE; i++) {
        var x = random_uniform(0, SEPARATION_POINT);
        var y = random_uniform(0, HEIGHT);
        game.new_mutation._add_new(gene, { x: x, y: y });
    }
};

game.new_mutation.right = function (gene) {
    var L = game._split().right;
    for (var i = 0; i < MUTATION_GROUP_SIZE; i++) game._kill_roullete(L);

    for (i = 0; i < MUTATION_GROUP_SIZE; i++) {
        var x = random_uniform(SEPARATION_POINT, WIDTH);
        var y = random_uniform(0, HEIGHT);
        game.new_mutation._add_new(gene, { x: x, y: y });
    }
};

game.new_mutation.random = function (gene) {
    for (var i = 0; i < MUTATION_GROUP_SIZE; i++) game._kill_roullete(game.cells.concat());

    for (i = 0; i < MUTATION_GROUP_SIZE; i++) {
        game.new_mutation._add_new(gene, undefined);
    }
};

game.remove_from_left = function () {};

/**
 * Bottleneck functions: they remove 75% of the population.
 */
game.bottleneck = {};

game.bottleneck.left = function () {
    for (var cell of game.cells.concat()) {
        if (cell.position.x < SEPARATION_POINT) {
            if (Math.random() < 0.5) cell.destroy();
        }
    }
};

game.bottleneck.right = function () {
    for (var cell of game.cells.concat()) {
        if (cell.position.x > SEPARATION_POINT) {
            if (Math.random() < 0.5) cell.destroy();
        }
    }
};

game.bottleneck.total = function () {
    for (var cell of game.cells.concat()) {
        if (Math.random() < 0.5) cell.destroy();
    }
};

game.reset_population = function () {
    for (var cell of game.cells.concat()) {
        cell.destroy();
    }

    game.cells = [];
    for (var i = 0; i < MAX_DENSITY; i++) {
        game.cells.push(newCell());
    }
};

/**
 * New population
 */
game.read_frequencies = function () {
    ALLELE_FREQS.a = [parseFloat($("allele-freq-a1").innerText), parseFloat($("allele-freq-a2").innerText), parseFloat($("allele-freq-a3").innerText)];

    ALLELE_FREQS.b = [parseFloat($("allele-freq-b1").innerText), parseFloat($("allele-freq-b2").innerText), parseFloat($("allele-freq-b3").innerText)];
};

game._insert_to_right = function () {
    return $("new-population-insert-right").checked;
};

game.replace_population = function () {};

/**
 * Simulation speed: these functions control the speed of simulation.
 */
game.speed = {};
game.speed.pause = function () {
    game.paused = true;
};

game.speed.normal = function () {
    game.paused = false;
    game._frames_per_step = 1;
    game._framerate_multiplier = 1;
    game._brownian_force_multiplier = 1;
    game.physics.p2.frameRate = 1 / 60;
};

game.speed.fast = function () {
    game.paused = false;
    game._frames_per_step = 1;
    game._framerate_multiplier = 5;
    game._brownian_force_multiplier = Math.sqrt(5);
    game.physics.p2.frameRate = 5 / 60;
};

game.speed.jump = function () {
    game.paused = true;
};

/**
 * Called after the broadphase before solving the collision.
 */
function onPresolve(presolve) {
    for (var eq of presolve.contactEquations) {

        // Fetch parents
        if (eq === undefined) continue;
        var parent_i = eq.bi.parent;
        var parent_j = eq.bj.parent;

        // Empty collisions and collisions with the boundaries
        if (parent_i === null || parent_j === null) continue;

        // Has a collisions with the division object
        var cell = eq.bi.parent.sprite;
        var division = eq.bj.parent.sprite;

        if (cell === game.division) {
            let aux = division;
            division = cell;
            cell = aux;
        }

        eq.enabled = true;
        if (division === game.division) {
            if (cell.migration_cooldown > 0) {
                eq.enabled = false;
            } else if (Math.random() < MIGRATION_PROBABILITY) {
                eq.enabled = false;
                cell.migration_cooldown = 60;
                cell.body.velocity.x += MIGRATION_DELTA_SPEED * (cell.is_right() ? -1 : 1);
            } else {
                cell.body.velocity.x *= -1;
                cell.body.velocity.x -= MIGRATION_DELTA_SPEED * (cell.is_right() ? -1 : 1);
            }
        }
    }
}

/**
 * FITNESS CALCULATIONS
 *
 * This sections include functions to manipulate the fitness of individuals based on their genetic data.
 */

var fitness = {};

fitness.table = {};

fitness.full = (function () {
    var out = {};
    for (var i = 1; i <= 3; i++) {
        for (var j = i; j <= 3; j++) {
            for (var k = 1; k <= 3; k++) {
                for (var r = k; r <= 3; r++) {
                    var name = "A" + i.toString() + j.toString() + "B" + k.toString() + r.toString();
                    out[name] = 1.0;
                }
            }
        }
    }
    return out;
})();

fitness.add_value = function () {
    var gene = $("#fitness-gene-name")[0].value.toUpperCase();
    var value = parseFloat($("#fitness-value")[0].value);
    var table = $("#fitness-table")[0];

    if (!fitness._validate_gene_name(gene)) {
        return;
    }
    for (var name of fitness.expand_name(gene)) {
        if (!(name in fitness.table)) {
            var row = table.insertRow(table.rows.length - 1);
            var cell1 = row.insertCell(0);
            var cell2 = row.insertCell(1);
            cell1.innerHTML = name;
            cell2.innerHTML = value;
        } else {
            for (var i = 1; i < table.rows.length - 1; i++) {
                var cellname = table.rows[i].cells[0].innerHTML;
                if (cellname === name) {
                    table.rows[i].cells[1].innerHTML = value;
                }
            }
        }
        fitness.table[name] = value;
    }

    for (var tag of fitness.expand_tag(gene)) {
        fitness.full[tag] = value;
    }
};

fitness.expand_name = function (gene) {
    var tags = fitness.expand_tag(gene);
    var out = [tags[0]];
    for (var i = 1; i < tags.length; i++) {
        if (tags[i] in fitness.table) {
            out.push(tags[i]);
        }
    }
    return out;
};

fitness.expand_tag = function (gene) {
    var out = [];
    var re = /([AB][123]+)([AB][123]+)?/;
    var match = re.exec(gene);
    var g1 = match[1];
    var g2 = match[2];

    // Normalize allele ordering
    var norm = fitness._normalize;
    var i, j, k, letter;

    if (g2 === undefined) {
        if (g1.length === 3) {
            g1 = norm(g1);
            out.push(g1);

            for (i = 1; i <= 3; i++) {
                for (j = i; j <= 3; j++) {
                    letter = g1[0] === "A" ? "B" : "A";
                    g2 = letter + i.toString() + j.toString();
                    if (g1[0] === "A") {
                        out.push(g1 + g2);
                    } else {
                        out.push(g2 + g1);
                    }
                }
            }
        } else {
            out.push(g1);

            for (k = 1; k <= 3; k++) {
                var g1k = norm(g1 + k);

                for (i = 1; i <= 3; i++) {
                    for (j = i; j <= 3; j++) {
                        letter = g1[0] === "A" ? "B" : "A";
                        g2 = letter + i.toString() + j.toString();
                        if (g1[0] === "A") {
                            out.push(g1k + g2);
                        } else {
                            out.push(g2k + g1);
                        }
                    }
                }
            }
        }
    } else {
        // Swap bad ordering
        if (g1[0] === "B") {
            var aux = g1;
            g1 = g2;
            g2 = aux;
        }

        if (g1.length === 3 && g2.length === 3) {
            out.push(norm(g1) + norm(g2));
        } else if (g1.length === 3) {
            out.push(norm(g1) + g2);
            for (i = 1; i <= 3; i++) {
                out.push(norm(g1) + norm(g2 + i.toString()));
            }
        } else if (g2.length === 3) {
            out.push(g1 + norm(g2));
            for (i = 1; i <= 3; i++) {
                out.push(norm(g1 + i.toString()) + norm(g2));
            }
        } else {
            out.push(g1 + g2);
            for (i = 1; i <= 3; i++) {
                for (j = 1; j <= 3; j++) {
                    out.push(norm(g1 + i.toString()) + norm(g2 + i.toString()));
                }
            }
        }
    }
    return out;
};

fitness._validate_gene_name = function (name) {
    var re = /^([AB])[123][123]?(?:([AB])[123][123]?)?$/;
    if (re.test(name)) {
        var match = re.exec(name);
        return match[1] != match[2];
    } else {
        return false;
    }
};

fitness._normalize = function (x) {
    if (parseInt(x[1]) > parseInt(x[2])) {
        return x[0] + x[2] + x[1];
    } else {
        return x;
    }
};

fitness.from_code = function (code) {
    var norm = fitness._normalize;
    return norm("A" + (code[0][0] + 1).toString() + (code[1][0] + 1).toString()) + norm("B" + (code[0][1] + 1).toString() + (code[1][1] + 1).toString());
};

/*******************************************************************************
 *
 * CELL OBJECTS
 *
 * These are the main elements in the game. They have physics properties, a
 * renderization and a genetic code.
 *
 * This is a simple function that return a cell object. Do not use the new
 * operator.
 *
 *******************************************************************************
 */
function newCell(args) {
    args = args || {};

    // Genetic code and gender
    var code;
    var gender = Math.random() > 0.5 ? 0 : 1;
    if (args.code === undefined) {
        code = random_code();
    } else {
        code = args.code;
    }
    var code_descr = fitness.from_code(code);
    var img_name = code_descr.replace("A", "").replace("B", "");
    img_name = (gender === 0 ? "f" : "m") + img_name;

    // Create new sprite and set default values
    var pos;
    if (args.pos === undefined) {
        pos = new Phaser.Point(Math.random() * WIDTH, Math.random() * HEIGHT);
    } else {
        pos = args.pos;
    }
    var cell = game.add.sprite(pos.x, pos.y, img_name);
    game.physics.p2.enable(cell);

    //  Enable physics
    game.physics.arcade.enable(cell);
    cell.body.collideWorldBounds = true;
    cell.body.allowRotation = true;
    cell.body.angle = 2;
    cell.body.onBeginContact.add(cell_collision, cell);
    cell.body.damping = LINEAR_DAMPING;
    cell.body.angularDamping = ANGULAR_DAMPING;

    // Bounding box
    cell.body.setRectangle(36, 24, 11, 8);

    // Biological information
    cell.code = code;
    cell.code_descr = code_descr;
    cell.gender = gender;
    cell.mating_duration = -MATING_DURATION;
    cell.mate = null;
    cell.fitness = 1.0;
    cell.migration_cooldown = 0;

    // Bind methods
    cell.prepare_frame = cell_update;
    cell.destroy = cell_destroy;
    cell.is_right = cell_is_right;
    cell.is_left = cell_is_left;

    // Done :-)
    return cell;
}

/**
 * Update cell at each frame.
 */
function cell_update() {
    // Binding
    var cell = this;

    // Lifespan
    cell.mating_duration += game._framerate_multiplier;
    cell.migration_cooldown -= game._framerate_multiplier;
    cell.fitness = fitness.full[cell.code_descr];

    // Brownian forces
    var strength = BROWNIAN_STRENGTH / game._brownian_force_multiplier;
    var force = cell.body.force;
    force.x = strength * (Math.random() - 0.5);
    force.y = strength * (Math.random() - 0.5);

    // Drift force
    var alpha = DRIFT_DAMPING;
    var v = DRIFT_VELOCITY;
    var theta = 2 * Math.PI * Math.random();
    var vdrift = new Phaser.Point(v * Math.cos(theta), v * Math.sin(theta));
    force.x += -alpha * (cell.body.velocity.x - vdrift.x);
    force.y += -alpha * (cell.body.velocity.y - vdrift.y);

    // Spring force -- mating
    if (cell.mate != null) {
        var other = cell.mate;
        var k = SPRING_CONSTANT;

        if (!(other.mate === cell)) {
            other.mate = null;
            cell.mate = null;
            return;
        }
        force.x -= k * (cell.position.x - other.position.x);
        force.y -= k * (cell.position.y - other.position.y);

        if (cell.mating_duration > MATING_DURATION) {
            cell.mate = null;
            other.mate = null;
            cell.mating_duration = -3 * MATING_DURATION;
            other.mating_duration = -3 * MATING_DURATION;

            for (var n = 0; n < OFFSPRING; n++) {
                var code = crossover(cell.code, other.code);
                var pos = new Phaser.Point((cell.position.x + other.position.x) / 2, (cell.position.y + other.position.y) / 2);
                //pos.x += 10 * (Math.random() - 0.5);
                //pos.y += 10 * (Math.random() - 0.5);

                var newcell = newCell({ code: mutate_code(code), pos: pos });
                game.cells.push(newcell);
            }
        }
    }
}

/**
 * Destroy cell object and remove it from the game.cells list
 */
function cell_destroy() {
    var cell = this;

    if (cell.mate != null) {
        cell.mate.mate = null;
    }

    for (var i = 0; i < game.cells.length; i++) {
        if (cell === game.cells[i]) {
            game.cells.splice(i, 1);
            cell.kill();
            break;
        }
    }
}

/**
 * Process cell collisions.
 *
 * The first argument is the "body" object of the cell.
 */
function cell_collision(body) {
    var cell1 = body.sprite;
    var cell2 = this;

    if (cell1.mate === null && cell2.mate === null && cell1.gender != cell2.gender && cell1.mating_duration > 0 && cell2.mating_duration > 0) {
        cell1.mate = cell2;
        cell2.mate = cell1;
        cell1.mating_duration = 0;
        cell2.mating_duration = 0;
    }
}

/**
 * Insert a single mutation point in the genetic code
 */
function mutate_code(code) {
    if (Math.random() < MUTATION_RATE_A) {
        code[Math.random() > 0.5 ? 0 : 1][0] = Math.floor(3 * Math.random());
    }

    if (Math.random() < MUTATION_RATE_B) {
        code[Math.random() > 0.5 ? 0 : 1][1] = Math.floor(3 * Math.random());
    }

    return code;
}

function crossover(codeA, codeB) {
    var i, j;
    i = Math.random() > 0.5 ? 0 : 1;
    if (Math.random() > LINKAGE) {
        j = Math.random() > 0.5 ? 0 : 1;
    } else {
        j = i;
    }
    var a0 = codeA[i][0];
    var a1 = codeA[j][1];

    i = Math.random() > 0.5 ? 0 : 1;
    if (Math.random() > LINKAGE) {
        j = Math.random() > 0.5 ? 0 : 1;
    } else {
        j = i;
    }
    var b0 = codeB[i][0];
    var b1 = codeB[j][1];

    return [[a0, a1], [b0, b1]];
}

/**
 * Query if cell is on left or right size of the population division
 */
function cell_is_left() {
    return this.position.x < SEPARATION_POINT;
}

function cell_is_right() {
    return this.position.x >= SEPARATION_POINT;
}

/*******************************************************************************
 *
 * STATISTICS
 *
 * This object control the global statistics about game elements.
 *
 *******************************************************************************
 */
var _node = function () {
    return { total: [], left: [], right: [] };
};

var stats = {
    // Population lists
    population: {
        total: [], left: [], right: [],
        male: _node(),
        female: _node(),
        gender: []
    },

    allele_a: [_node(), _node(), _node()],
    allele_b: [_node(), _node(), _node()],

    genotype_a: [[_node(), _node(), _node()], [undefined, _node(), _node()], [undefined, undefined, _node()]],
    genotype_b: [[_node(), _node(), _node()], [undefined, _node(), _node()], [undefined, undefined, _node()]],

    // Other attributes
    update_tables: true
};

// Gender aliases
stats.population.gender[0] = stats.population.male;
stats.population.gender[1] = stats.population.female;

/**
 * Call `counter` function to update the given node with some statistics
 */
stats._update_node = function (populations, node, counter) {
    node.total.push(counter(populations.total));
    node.left.push(counter(populations.left));
    node.right.push(counter(populations.right));
};

/**
 * Update all statistics.
 *
 * Maybe it is better to split this function across several frames in order to
 * distribute the load.
 *
 * It is here for an easy implementation.
 */
stats.update = function () {
    // Prepare populations
    var populations = {
        total: game.cells,
        left: [],
        right: []
    };

    for (var cell of game.cells) {
        if (cell.position.x > SEPARATION_POINT) {
            populations.right.push(cell);
        } else {
            populations.left.push(cell);
        }
    }

    stats.update_population(populations);
    stats.update_alleles(populations);
    stats.update_genotype(populations);
};

/**
 * Update population information.
 */
stats.update_population = function (pop) {
    // Count gender and position for each node
    this._update_node(pop, stats.population, function (L) {
        return L.length;
    });
    for (var gender = 0; gender < 2; gender++) {
        this._update_node(pop, stats.population.gender[gender], function (L) {
            var N = 0;
            for (var x of L) {
                if (x.gender == gender) {
                    N++;
                }
            }
            return N;
        });
    }

    this._update_gender_table();
};

stats._update_gender_table = function () {
    var last = function (L) {
        return L[L.length - 1];
    };
    var template = TEMPLATES['stats-table-count-tbody'];
    var tbody = $('#stats-table-count-tbody');
    var data = {
        males: last(stats.population.male.total),
        males_left: last(stats.population.male.left),
        males_right: last(stats.population.male.right),
        females: last(stats.population.female.total),
        females_left: last(stats.population.female.left),
        females_right: last(stats.population.female.right),
        total: last(stats.population.total),
        total_left: last(stats.population.left),
        total_right: last(stats.population.right)
    };
    var rendered = Mustache.render(template, data);
    tbody.html(rendered);
};

/**
 * Update alleles statistics.
 */
stats._count_alleles = function (L, i, pos) {
    var total = 0;
    pos = pos || 0;
    for (var cell of L) {
        for (var strip of cell.code) {
            if (strip[pos] === i) {
                total++;
            }
        }
    }
    return total;
};

stats._update_alleles_table = function () {
    var template = TEMPLATES['stats-table-tbody'];
    var last = function (L) {
        return L[L.length - 1].toFixed(1);
    };
    var tbody = $('#stats-table-alleles-tbody');
    var rows = [];

    for (var gene of ['a', 'b']) {
        var L = this['allele_' + gene];

        for (var i = 0; i < 3; i++) {
            var name = gene.toUpperCase() + (i + 1).toString();
            var stats = L[i];
            var row = {
                name: name,
                left: last(stats.left),
                right: last(stats.right),
                total: last(stats.total)
            };
            rows.push(row);
        }
    }
    var rendered = Mustache.render(template, { rows: rows });
    tbody.html(rendered);
};

stats.update_alleles = function (pop) {
    var counter = this._count_alleles;

    for (let i = 0; i < 3; i++) {
        this._update_node(pop, stats.allele_a[i], function (L) {
            return 100 * counter(L, i, 0) / (2 * L.length);
        });
        this._update_node(pop, stats.allele_b[i], function (L) {
            return 100 * counter(L, i, 1) / (2 * L.length);
        });
    }

    if (this.update_tables) {
        this._update_alleles_table();
    }
};

/**
 * Update genotype statistics.
 */
stats._count_genotypes = function (L, i, j, pos) {
    var total = 0;
    pos = pos || 0;
    for (var cell of L) {
        if (cell.code[0][pos] === i && cell.code[1][pos] === j) {
            total++;
        }
    }
    return total;
};

stats._update_genotype_table = function () {
    var template = TEMPLATES['stats-table-tbody'];
    var last = function (L) {
        return L[L.length - 1].toFixed(1);
    };

    for (var gene of ['a', 'b']) {
        var L = this['genotype_' + gene];
        var rows = [];
        var tbody = $('#stats-table-genetic-' + gene + '-tbody');
        for (var pair of [[0, 0], [1, 1], [2, 2], [0, 1], [0, 2], [1, 2]]) {
            var i = pair[0];
            var j = pair[1];
            var name = gene.toUpperCase() + (i + 1).toString() + (j + 1).toString();
            var stats = L[i][j];
            var row = {
                name: name,
                left: last(stats.left),
                right: last(stats.right),
                total: last(stats.total)
            };
            rows.push(row);
        }
        var rendered = Mustache.render(template, { rows: rows });
        tbody.html(rendered);
    }
};

stats.update_genotype = function (pop) {
    var counter = this._count_genotypes;

    for (let i = 0; i < 3; i++) {
        for (let j = i; j < 3; j++) {
            this._update_node(pop, stats.genotype_a[i][j], function (L) {
                return 100 * (counter(L, i, j, 0) + (i == j ? 0 : counter(L, j, i, 0))) / L.length;
            });

            this._update_node(pop, stats.genotype_b[i][j], function (L) {
                return 100 * (counter(L, i, j, 1) + (i == j ? 0 : counter(L, j, i, 1))) / L.length;
            });
        }
    }

    if (this.update_tables) {
        this._update_genotype_table();
    }
};

/*******************************************************************************
 *
 * MATH FUNCTIONS
 *
 * Routines with mathematical and statistical operations
 *
 *******************************************************************************
 */

function roullete(L) {
    var r = Math.random();
    var S = 0;
    for (var i = 0; i <= L.length; i++) {
        S += L[i];
        if (r <= S) {
            return i;
        }
    }
    return L.length;
}

/**
 * Return a random integer in the range [n, m].
 */
function randint(n, m) {
    var epsilon = 1e-6;
    return Math.floor(Math.random() * (m - n + 1 - epsilon)) + n;
}

/**
 * Return a random number uniformly distributed on the interval
 */
function random_uniform(start, end) {
    var delta = end - start;
    return start + Math.random() * delta;
}

/**
 * Return a random genetic code
 */
function random_code() {
    var code = [[0, 0], [0, 0]];

    // first chromossome
    var a = roullete(ALLELE_FREQS.a);
    var b = roullete(ALLELE_FREQS.b);
    code[0] = [a, b];

    // second chromossome
    a = roullete(ALLELE_FREQS.a);
    b = roullete(ALLELE_FREQS.b);
    code[1] = [a, b];

    return code;
}

/*******************************************************************************
 *
 * UI INTERACTION
 *
 * These functions update and poll information from the UI.
 * There are 3 loops. The slow loop runs every half second, the fast loop
 * runs every 0.1 second and the instant runs every frame (1/60 seconds).
 *
 *******************************************************************************
 */
function ui_create() {
    ui_create_templates();
}

function ui_create_templates() {
    var template;

    // Table body for counting number of elements
    template = "<tr>\
      <td>Female</td>\
      <td>{{females}}</td>\
      <td>{{females_left}}</td>\
      <td>{{females_right}}</td>\
    </tr>\
    <tr>\
      <td>Male</td>\
      <td>{{males}}</td>\
      <td>{{males_left}}</td>\
      <td>{{males_right}}</td>\
    </tr>\
    <tr>\
      <td>Total</td>\
      <td>{{total}}</td>\
      <td>{{total_left}}</td>\
      <td>{{total_right}}</td>\
    </tr>";
    Mustache.parse(template);
    TEMPLATES['stats-table-count-tbody'] = template;

    // Table body for allele frequencies
    template = '{{#rows}}\
        <tr>\
          <td>{{name}}</td>\
          <td>{{total}}</td> <td>{{left}}</td> <td>{{right}}</td>\
        </tr>{{/rows}}';
    Mustache.parse(template);
    TEMPLATES['stats-table-tbody'] = template;
}

// Update simulation values from sliders
function ui_update_sliders() {
    // Separation force
    var slider = document.getElementById('input-separation-force');
    var value = slider.value | 0;
    MIGRATION_PROBABILITY = (100 - value) / 100;

    // Maximum density
    slider = document.getElementById('input-max-density');
    value = slider.value | 0;
    if (value >= 50) {
        MAX_DENSITY = 2 * value;
    } else {
        MAX_DENSITY = 12.5 + 1.75 * value;
    }

    // Selection pressure
    slider = document.getElementById('input-selection-pressure');
    value = slider.value | 0;
    FITNESS_EXPONENT = value / 50;

    // Separtion position
    slider = document.getElementById('input-separation-point');
    value = slider.value | 0;
    SEPARATION_POINT = (15 + 0.70 * value) / 100 * WIDTH;

    // Mutation rate
    slider = document.getElementById('input-mutation-rate-a');
    value = slider.value | 0;
    MUTATION_RATE_A = Math.pow(value / 100, 3);

    slider = document.getElementById('input-mutation-rate-b');
    value = slider.value | 0;
    MUTATION_RATE_B = Math.pow(value / 100, 3);

    // Linkage
    slider = document.getElementById('input-linkage');
    value = slider.value | 0;
    LINKAGE = value / 100;
}

/**
 * Toggle the visibility of an element
 */
function toggle_visibility(elem) {
    if ($(elem).css('display') == 'none') {
        $(elem).css('display', 'block');
    } else {
        $(elem).css('display', 'none');
    }
}

/*******************************************************************************
 *
 * UTILITY FUNCTIONS
 *
 * Unsorted helper functions.
 *
 *******************************************************************************
 */

/**
 * Debug print
 */
function dbg(text) {
    var dbgdiv = document.getElementById("debug-area");
    dbgdiv.textContent = text;
}

/**
 * Make a dynamic javascript content downloadable.
 */
function download(filename, text) {
    var element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

/**
 * Push element to end of list, but truncates the array if it exceeds the
 * maximum size `maxsize`.
 */
function push_trunc(list, value, maxsize) {
    if (maxsize === undefined) {
        maxsize = 100;
    }
    if (list.length > maxsize - 1) {
        list.splice(0, 1);
    }
    list.push(value);
}

/**
 * Return an enumeration array for the input list of elements
 */
function enumerate(list) {
    var result = [];
    var i = 0;
    for (var x of list) {
        result.push([i, x]);
        i++;
    }
    return result;
}

/**
 * Enumerate the last N elements of the array
 */
function enumerate_last(list, N) {
    var result = [];
    var delta = list.length - N;
    if (delta <= 0) {
        return enumerate(list);
    }
    for (var i = 0; i < N; i++) {
        result.push([i, list[i + delta]]);
    }
    return result;
}

/**
 * Push an element in an array of numbers that is equal to the last element
 * plus the given increment. If no increment is given, assume 1.
 *
 * Returns the pushed value.
 */
function push_inc(list, inc) {
    var value;

    inc = inc === undefined ? 1 : inc;
    value = list[list.length - 1];
    if (value == undefined) {
        value = 0;
    }
    value += inc;
    list.push(value);
    return value;
}

/**
 * Setup plots
 */
var plots = {
    _track_gene: "A"
};

plots.track_gene = function (which) {
    plots._track_gene = which;
    $('#plot-allele-name').html(which);
};

$(function () {
    plots.population = $.plot("#plot-population", [[]], {
        series: { shadowSize: 0 },
        yaxis: { min: 0, max: 200 },
        xaxis: { min: 0, max: 300, show: false }
    });

    plots.allele_a = $.plot("#plot-allele-a", [[]], {
        series: { shadowSize: 0 },
        yaxis: { min: 0, max: 100 },
        xaxis: { min: 0, max: 300, show: false }
    });
});

plots.update = function () {
    if (stats.population.total.length > 1) {
        // Population plots
        plots.population.setData([enumerate_last(stats.population.total, 300), enumerate_last(stats.population.left, 300), enumerate_last(stats.population.right, 300)]);
        plots.population.draw();

        // Allele-A
        var data = plots._track_gene === "A" ? stats.allele_a : stats.allele_b;
        plots.allele_a.setData([enumerate_last(data[0].total, 300), enumerate_last(data[1].total, 300), enumerate_last(data[2].total, 300)]);
        plots.allele_a.draw();
    }
};

//# sourceMappingURL=bubble-compiled.js.map