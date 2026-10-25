// places.js - quick-pick place names, grouped by where you are.
// Used by the room-by-room survey and by "Survey around me".
export const PLACE_GROUPS = {
  College: ['Classroom', 'Lab', 'Library', 'Corridor', 'Canteen', 'Staff room', 'Seminar hall', 'Hostel room'],
  Home: ['Living room', 'Bedroom', 'Kitchen', 'Hall', 'Study', 'Dining room', 'Bathroom', 'Balcony'],
  Office: ['Desk area', 'Meeting room', 'Reception', 'Cabin', 'Pantry', 'Server room'],
}

// Survey-around-me sizes: a square of this many metres with you in the centre.
export const RANGES = [
  { m: 5, hint: 'one room / your desk area' },
  { m: 10, hint: 'a classroom or a flat' },
  { m: 15, hint: 'a lab or a big hall' },
  { m: 20, hint: 'a large lab, a house' },
  { m: 30, hint: 'a corridor or a whole floor wing' },
  { m: 50, hint: 'a whole floor / building' },
]
