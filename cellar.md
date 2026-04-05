# Beer Cellar Management App

I am a beer enthusiast and I have a modest cellar of beers I am aging.  The goal of this app is to make it easy for me to see which beers are currently in my cellar, update my cellar when I buy new beers or drink a bottle, assess which beers in my cellar are at their optimal drinking age now, and see when each beer will be at their optimal drinking age in the future.  

# Scenarios

1. **View beers.**  When the app is opened, all the cellared beers are displayed along with all essential metadata.
  1. **Sort:  **User can sort the list by each sortable column
  2. **Filter:  **User can  filter the list by filterable values, e.g. Brewer
2. **View beer details.  **User can select a single beer to see all details about that beer
3. **Add beer.  **User acquires a new beer, add that beer to the database
  1. **Form-based:  **User fills out a form with known metadata about the beer required.
  2. **Photo-based:  **User simply snaps a photo of the beer (or beers!) he acquired, and uploads those photos - the app or agent interprets those photos and handles the populates the metadata.  The user reviews the details extracted from the photo before saving.
4. **Mark as imbibed.** User marks a beer as consumed ("Happily Imbibed"). The beer stays in the database for history but moves to the bottom of the table view and is visually dimmed. The status filter includes "Happily Imbibed" to show/hide these records.

## The Role of the You, The Agent

You, the agent, come into play here in a couple of different ways.  Obviosuly, you'll be writing the code for this app and owning the implementation.  But I'm also looking for you to become a "beer sommelier" of sorts.  Every beer I add to my cellar, I need you to form a point of view on how long I should age the beer before drinking.  You'll need information from the Internet to form this point of view - beer forms and reviews will be very helpful, as will forming a picture of how different ingredients in each beer behave under aging.  Of course, this is an art just as much as it is a science, so perfect precision is not always important - at the end of the day, your recommendations are just suggestions!

# Implementation

This app is really just a database.  The core tasks of viewing beers, viewing beer details, and adding beers should feel familiar to users of database systems like Airtable, Microsoft Lists, Monday.com, etc.  The agent should evaluate whether it's cheaper and easier to actually use one of these platforms for data storage, or even build the entire app on one of these platforms.  However, given the simplicity of most of the user operations here, it might be simpler (and more fun!) to just build everything from scratch.

## Schema

These are the most important fields to include and display always:

1. **Beer name** - required, user specified. Should not include the year (stored separately) or brewer name (already its own field).
2. **Year** - integer (e.g. 2024), optional. The vintage year of the beer, displayed immediately after the name.
3. **Brewer** - required, user specified
4. **ABV** - optional, numeric (e.g. 7.44). Agent-populated from research when available.
5. **Quantity** - integer, default 1. Tracks multiple bottles of the same beer without creating duplicate rows.
5. **Date bottled** - this will not always be clear, OK to be empty. Sometimes user specified
6. **Drink after** - all beers are technically ready to drink. This should be populated when the agent has determined from available information that there is a peak date to hit through aging, and after which there's no more aging benefit. Some beers will have more publicly available information than others - for example, beers from Floodland Brewing always have cellaring notes released with them from the head brewer.
7. **Drink by** - Based on the agent's opinion, by which date should the beer be consumed?
8. **Date imbibed** - set when the user has consumed this beer. Triggers the "Happily Imbibed" status. Beer remains in the database for historical tracking.

These are secondary fields that should be available when viewing details about a single beer:

1. **Research** - a set of notes and references (hyperlinks) that describe how the agent came up with its recommendations.
2. **Food pairings** - based on the agent's research, some ideas of food pairings that might go well with this beer. OK to be blank.
3. **Other considerations** - Any other notes about this beer that the agent thinks the user should know.
4. **Image URL** - the source URL the agent used to download the beer's label image. Stored for reference and re-fetching.

### Image display

Each beer displays a label image to the left of its name. Image resolution follows this fallback chain:
1. Beer-specific label (downloaded by agent, stored at `static/images/beers/beer_{id}.jpg`)
2. Brewer logo (stored at `static/images/brewers/{brewer_slug}.png`)
3. Generic default beer icon

The agent downloads the best available image (preferring high-resolution) when adding a beer. **Phase 3** will add the ability for users to upload their own images directly from their photo gallery.

# Staging

## Phase 1:  Local machine.

In this phase, the beer database will be available only on my local machine where we do our ptototyping and development.  All beers will be added/removed through a conversation with the agent on the local machine.  

## Phase 2:  View from cloud, Updates pushed from local machine

In this phase, the beer database will be available on any Internet-connected device that can access the app hyperlink.  New beers will still be added through conversations with the agent locally, and these changes will be "pushed" to the cloud so they're visible through the hyperlink.

## Phase 3:  Add from anywhere

In this phase, all app functionality will be available on the Web - viewing, adding, and removing beers will work from any Internet-connected browser.

## Phase 4:  Authenticated, multi-user

In this phase, we'll create a full-fledged "SaaS app" where users can sign up, sign in, build, and share their own beer databases.  In the beginning, we should think of this as a far-off milestone once all the UX concepts are solid, so no need to get distracted at first with the need to sign in/sign up - but we should keep this in mind as a future goal and not build us into a corner where this will require an entire re-build of the app.