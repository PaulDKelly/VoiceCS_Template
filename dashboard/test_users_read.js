const fs = require('fs');
const path = require('path');

console.log("CWD:", process.cwd());

const configPath = path.resolve(process.cwd(), '../shared_code/config');
console.log("Calculated Config Path:", configPath);

const usersPath = path.join(configPath, 'users.json');
console.log("Users Path:", usersPath);

if (fs.existsSync(usersPath)) {
    console.log("File exists!");
    const content = fs.readFileSync(usersPath, 'utf-8');
    try {
        const json = JSON.parse(content);
        console.log("Parsed JSON:", JSON.stringify(json, null, 2));
        const user = json.users.find(u => u.username === 'admin');
        console.log("Found admin:", !!user);
    } catch (e) {
        console.error("JSON Parse Error:", e);
    }
} else {
    console.error("File does NOT exist!");
    // List dir to see what is there
    try {
        console.log("Dir contents:", fs.readdirSync(configPath));
    } catch (e) {
        console.log("Dir contents failed:", e.message);
    }
}
