#!/usr/bin/env bash
set -e

# Build all Maven modules in the project, keeping artifacts in the project directory
mvn clean package

# Copy all runtime dependencies for the main jicofo module
cd jicofo
mvn dependency:copy-dependencies -DoutputDirectory=target/dependency
cd ..

echo "Build complete. Artifacts and dependencies are in their respective target/ folders." 