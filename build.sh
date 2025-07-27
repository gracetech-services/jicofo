#!/usr/bin/env bash
set -e

# Build and install all Maven modules so dependencies are available locally
mvn clean install

# Build the main jicofo module and copy all runtime dependencies
cd jicofo
mvn package
mvn dependency:copy-dependencies -DoutputDirectory=target/dependency
cd ..

echo "Build complete. Artifacts and dependencies are in their respective target/ folders." 