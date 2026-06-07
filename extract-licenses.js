const checker = require("license-checker-rseidelsohn");
const fs = require("fs");
const path = require("path");

checker.init({ start: __dirname, production: true }, (err, packages) => {
  const licenses = [];

  for (const [packageName, details] of Object.entries(packages)) {
    const licensePath = details.licenseFile;
    let licenseText = "License text not found in package.";

    // Read the license text if it exists
    if (licensePath && fs.existsSync(licensePath)) {
      licenseText = fs.readFileSync(licensePath, "utf8");
    }

    licenses.push({
      package: packageName,
      version: details.version,
      licenses: details.licenses,
      licenseText: licenseText,
    });
  }

  // Save the extracted data to the public folder for the React app to consume
  const outputPath = path.join(__dirname, "public", "all-licenses.json");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  fs.writeFileSync(outputPath, JSON.stringify(licenses, null, 2));
  console.log(
    `Successfully wrote ${licenses.length} licenses to public/all-licenses.json`,
  );
});
