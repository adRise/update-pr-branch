#!/bin/bash

# One-time setup script to create rolling tags for existing releases
# This should be run once to establish the rolling tag pattern

set -e

echo "🏷️  Setting up rolling tags for existing releases..."

# Get the latest semantic version tag
LATEST_TAG=$(git tag --list | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)

if [[ -z "$LATEST_TAG" ]]; then
    echo "❌ No semantic version tags found (format: vX.Y.Z)"
    exit 1
fi

echo "📍 Latest release: $LATEST_TAG"

# Extract version components
VERSION=${LATEST_TAG#v}  # Remove 'v' prefix
IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"

echo "🔍 Version components: MAJOR=$MAJOR, MINOR=$MINOR, PATCH=$PATCH"

# Create major version tag (e.g., v0)
MAJOR_TAG="v$MAJOR"
echo "📝 Creating major tag: $MAJOR_TAG -> $LATEST_TAG"
git tag -fa "$MAJOR_TAG" -m "Rolling tag for major version $MAJOR (currently $LATEST_TAG)"

# Create minor version tag (e.g., v0.10)
MINOR_TAG="v$MAJOR.$MINOR"
echo "📝 Creating minor tag: $MINOR_TAG -> $LATEST_TAG"
git tag -fa "$MINOR_TAG" -m "Rolling tag for minor version $MAJOR.$MINOR (currently $LATEST_TAG)"

# Show what we created
echo ""
echo "✅ Rolling tags created successfully:"
echo "   $MAJOR_TAG -> $LATEST_TAG"
echo "   $MINOR_TAG -> $LATEST_TAG"
echo ""
echo "🚀 To push these tags to the remote repository, run:"
echo "   git push origin $MAJOR_TAG --force"
echo "   git push origin $MINOR_TAG --force"
echo ""
echo "💡 Future releases will automatically update these rolling tags via GitHub Actions."

# Optionally push immediately (uncomment the lines below if you want auto-push)
# echo "🔄 Pushing tags to remote..."
# git push origin "$MAJOR_TAG" --force
# git push origin "$MINOR_TAG" --force
# echo "✅ Tags pushed successfully!"
