/**
 * MediBook — Specialization catalog
 *
 * Single source of truth for the home-page "Browse by Specialization" tiles,
 * the footer links, and the dedicated specialization detail pages
 * (/specializations/:slug).
 *
 * `name` MUST match the value stored in doctors.specialization so the detail
 * page can list the right doctors.
 *
 * Icons are verified against the installed bootstrap-icons (v1.11.3).
 */

export const SPECIALIZATIONS = [
  {
    slug: 'cardiology',
    name: 'Cardiology',
    icon: 'bi-heart-pulse',
    desc: 'Heart & Blood Vessels',
    tagline: 'Comprehensive care for your heart and circulatory system.',
    overview:
      'Cardiology is the branch of medicine that deals with disorders of the heart and blood vessels. Cardiologists diagnose and treat conditions such as heart disease, high blood pressure, and heart rhythm problems, and they help patients manage long-term heart health.',
    advanced: [
      'Interventional procedures such as angioplasty and stent placement to open blocked arteries.',
      'Electrophysiology studies and pacemaker or defibrillator implantation for rhythm disorders.',
      'Advanced cardiac imaging including echocardiography, stress testing, and cardiac MRI.',
      'Management of heart failure and structural heart disease.',
    ],
    commonConditions: [
      'Coronary artery disease', 'Hypertension (high blood pressure)',
      'Arrhythmia (irregular heartbeat)', 'Heart failure', 'Valve disorders',
    ],
    procedures: [
      'ECG / EKG', 'Echocardiogram', 'Stress test', 'Angiography', 'Holter monitoring',
    ],
    whenToVisit: [
      'Chest pain, pressure, or discomfort',
      'Shortness of breath during routine activity',
      'Palpitations or a racing/irregular heartbeat',
      'Persistently high blood pressure',
      'Family history of heart disease',
    ],
    faqs: [
      { q: 'How often should I get a heart check-up?', a: 'Adults with risk factors should have their heart health reviewed annually. Your cardiologist will tailor a schedule based on your history.' },
      { q: 'Are heart palpitations always serious?', a: 'Not always, but recurrent or symptomatic palpitations should be evaluated to rule out an underlying rhythm disorder.' },
    ],
  },
  {
    slug: 'neurology',
    name: 'Neurology',
    icon: 'bi-lightning',
    desc: 'Brain & Nervous System',
    tagline: 'Diagnosis and treatment of the brain, spine, and nerves.',
    overview:
      'Neurology focuses on disorders of the nervous system, including the brain, spinal cord, and peripheral nerves. Neurologists evaluate symptoms like headaches, seizures, numbness, and memory changes to diagnose and manage neurological conditions.',
    advanced: [
      'Electroencephalography (EEG) and nerve conduction studies for seizures and nerve disorders.',
      'Management of chronic conditions such as epilepsy, multiple sclerosis, and Parkinson\u2019s disease.',
      'Stroke evaluation and long-term prevention planning.',
      'Botulinum toxin therapy for migraine and movement disorders.',
    ],
    commonConditions: [
      'Migraine & chronic headache', 'Epilepsy / seizures', 'Stroke',
      'Parkinson\u2019s disease', 'Peripheral neuropathy',
    ],
    procedures: [
      'EEG', 'EMG / nerve conduction study', 'Lumbar puncture', 'Neuro-imaging review',
    ],
    whenToVisit: [
      'Frequent or severe headaches',
      'Seizures or episodes of loss of awareness',
      'Numbness, tingling, or weakness in limbs',
      'Memory loss or confusion',
      'Tremors or balance problems',
    ],
    faqs: [
      { q: 'When is a headache a reason to see a neurologist?', a: 'Sudden severe headaches, headaches with neurological symptoms, or a change in your usual pattern should be evaluated.' },
      { q: 'Can neurological conditions be cured?', a: 'Many can be effectively managed to reduce symptoms and slow progression, though outcomes depend on the specific condition.' },
    ],
  },
  {
    slug: 'orthopedics',
    name: 'Orthopedics',
    icon: 'bi-bandaid',
    desc: 'Bones & Joints',
    tagline: 'Care for bones, joints, muscles, and the musculoskeletal system.',
    overview:
      'Orthopedics deals with the musculoskeletal system \u2014 bones, joints, ligaments, tendons, and muscles. Orthopedic specialists treat fractures, sports injuries, arthritis, and degenerative joint conditions, both surgically and non-surgically.',
    advanced: [
      'Joint replacement surgery (knee, hip, and shoulder).',
      'Arthroscopic (keyhole) procedures for joint repair.',
      'Sports medicine and ligament reconstruction.',
      'Fracture fixation and management of complex trauma.',
    ],
    commonConditions: [
      'Fractures & dislocations', 'Osteoarthritis', 'Sports injuries',
      'Back & spine pain', 'Ligament & tendon tears',
    ],
    procedures: [
      'X-ray & bone imaging review', 'Joint injections', 'Arthroscopy', 'Joint replacement', 'Casting & splinting',
    ],
    whenToVisit: [
      'Joint pain that limits movement',
      'Swelling or stiffness in joints',
      'An injury that is not healing',
      'Difficulty walking or bearing weight',
      'Recurring back or neck pain',
    ],
    faqs: [
      { q: 'Do all orthopedic problems need surgery?', a: 'No. Many conditions are managed with physiotherapy, medication, and lifestyle changes. Surgery is considered when conservative care is not enough.' },
      { q: 'How long is recovery after a joint replacement?', a: 'It varies, but many patients resume daily activities within weeks, with full recovery over a few months alongside rehabilitation.' },
    ],
  },
  {
    slug: 'pediatrics',
    name: 'Pediatrics',
    icon: 'bi-emoji-smile',
    desc: 'Child Healthcare',
    tagline: 'Dedicated healthcare for infants, children, and adolescents.',
    overview:
      'Pediatrics is the medical care of infants, children, and adolescents. Pediatricians monitor growth and development, provide vaccinations, and treat childhood illnesses, supporting families through every stage of a child\u2019s health.',
    advanced: [
      'Developmental and growth monitoring with milestone assessment.',
      'Childhood immunization scheduling and catch-up vaccination.',
      'Management of chronic childhood conditions such as asthma.',
      'Neonatal and newborn care guidance.',
    ],
    commonConditions: [
      'Common infections (cold, flu, ear infections)', 'Childhood asthma & allergies',
      'Growth & nutrition concerns', 'Vaccination needs', 'Fever & rashes',
    ],
    procedures: [
      'Well-child check-ups', 'Immunizations', 'Growth assessment', 'Developmental screening',
    ],
    whenToVisit: [
      'Routine well-child and vaccination visits',
      'Persistent fever in a child',
      'Concerns about growth or development',
      'Recurrent infections',
      'Feeding or sleep difficulties',
    ],
    faqs: [
      { q: 'How often should my child see a pediatrician?', a: 'Infants are seen frequently in the first year; older children typically have annual well-child visits in addition to sick visits.' },
      { q: 'Are vaccinations safe?', a: 'Vaccines are rigorously tested and are one of the most effective ways to protect children from serious diseases.' },
    ],
  },
  {
    slug: 'dermatology',
    name: 'Dermatology',
    icon: 'bi-droplet',
    desc: 'Skin & Hair',
    tagline: 'Treatment for skin, hair, and nail conditions.',
    overview:
      'Dermatology covers the diagnosis and treatment of conditions affecting the skin, hair, and nails. Dermatologists address concerns ranging from acne and eczema to skin cancer screening and cosmetic care.',
    advanced: [
      'Skin cancer screening, biopsy, and removal.',
      'Phototherapy and advanced treatment for psoriasis and eczema.',
      'Laser therapy for pigmentation and scarring.',
      'Management of chronic hair and scalp disorders.',
    ],
    commonConditions: [
      'Acne', 'Eczema & dermatitis', 'Psoriasis', 'Skin infections', 'Hair loss',
    ],
    procedures: [
      'Skin examination & dermoscopy', 'Biopsy', 'Cryotherapy', 'Laser treatment', 'Patch testing',
    ],
    whenToVisit: [
      'Persistent rashes or itching',
      'New or changing moles',
      'Severe or scarring acne',
      'Unexplained hair loss',
      'Chronic nail problems',
    ],
    faqs: [
      { q: 'When should I get a mole checked?', a: 'See a dermatologist if a mole changes in size, shape, or color, bleeds, or looks different from your others.' },
      { q: 'Can acne be cured?', a: 'Acne can be effectively controlled with the right treatment plan, though it may require ongoing management.' },
    ],
  },
  {
    slug: 'ophthalmology',
    name: 'Ophthalmology',
    icon: 'bi-eye',
    desc: 'Eye Care',
    tagline: 'Complete eye care, from vision tests to eye surgery.',
    overview:
      'Ophthalmology is the medical and surgical care of the eyes. Ophthalmologists diagnose and treat vision problems and eye diseases, perform eye surgery, and help preserve and restore sight.',
    advanced: [
      'Cataract surgery and lens implantation.',
      'Laser vision correction (LASIK).',
      'Management of glaucoma and diabetic eye disease.',
      'Retinal evaluation and treatment.',
    ],
    commonConditions: [
      'Refractive errors (myopia, hyperopia)', 'Cataracts', 'Glaucoma',
      'Dry eye syndrome', 'Conjunctivitis',
    ],
    procedures: [
      'Comprehensive eye exam', 'Vision & refraction test', 'Tonometry (eye pressure)', 'Retinal imaging', 'Cataract surgery',
    ],
    whenToVisit: [
      'Blurred or declining vision',
      'Eye pain, redness, or persistent irritation',
      'Sudden flashes or floaters',
      'Difficulty seeing at night',
      'Routine vision screening',
    ],
    faqs: [
      { q: 'How often should I have an eye exam?', a: 'Adults should have a comprehensive eye exam every one to two years, or more often with diabetes or existing eye conditions.' },
      { q: 'Is LASIK suitable for everyone?', a: 'Not everyone is a candidate. Suitability depends on your prescription, corneal thickness, and overall eye health.' },
    ],
  },
  {
    slug: 'general-physician',
    name: 'General Physician',
    icon: 'bi-thermometer-half',
    desc: 'General Healthcare',
    tagline: 'Your first point of contact for everyday health concerns.',
    overview:
      'A general physician provides primary care for a wide range of health issues. They diagnose and treat common illnesses, manage long-term conditions, offer preventive care, and refer you to specialists when needed.',
    advanced: [
      'Management of chronic conditions such as diabetes and hypertension.',
      'Preventive health screening and lifestyle counseling.',
      'Coordination of care across specialists.',
      'Routine health check-ups and vaccination guidance.',
    ],
    commonConditions: [
      'Fever & infections', 'Diabetes', 'Hypertension', 'Respiratory illness', 'General fatigue & weakness',
    ],
    procedures: [
      'General health check-up', 'Blood pressure & sugar monitoring', 'Basic lab test review', 'Preventive screening',
    ],
    whenToVisit: [
      'Fever, cough, cold, or flu-like symptoms',
      'General check-ups and health screening',
      'Management of ongoing conditions',
      'Unexplained tiredness or weakness',
      'When you are unsure which specialist to see',
    ],
    faqs: [
      { q: 'When should I see a specialist instead?', a: 'Start with a general physician \u2014 they will assess your condition and refer you to a specialist if your case requires focused care.' },
      { q: 'How often should I get a general check-up?', a: 'An annual general health check-up is recommended for most adults, and more frequently if you have chronic conditions.' },
    ],
  },
  {
    slug: 'psychiatry',
    name: 'Psychiatry',
    icon: 'bi-clipboard2-pulse',
    desc: 'Mental Health',
    tagline: 'Compassionate care for mental and emotional wellbeing.',
    overview:
      'Psychiatry is the branch of medicine focused on mental, emotional, and behavioral health. Psychiatrists diagnose and treat conditions such as depression, anxiety, and other mental health disorders through therapy, medication, and ongoing support.',
    advanced: [
      'Medication management for mood and anxiety disorders.',
      'Treatment planning for conditions such as bipolar disorder.',
      'Psychotherapy and counseling coordination.',
      'Support for sleep, stress, and behavioral concerns.',
    ],
    commonConditions: [
      'Depression', 'Anxiety disorders', 'Sleep disorders', 'Stress & burnout', 'Mood disorders',
    ],
    procedures: [
      'Mental health assessment', 'Therapy & counseling', 'Medication review', 'Follow-up support',
    ],
    whenToVisit: [
      'Persistent sadness or loss of interest',
      'Overwhelming worry or anxiety',
      'Difficulty sleeping or concentrating',
      'Changes in mood, appetite, or energy',
      'Feeling unable to cope with daily life',
    ],
    faqs: [
      { q: 'Is what I share with a psychiatrist confidential?', a: 'Yes. Your sessions are private and handled with strict confidentiality, within the limits of safety and the law.' },
      { q: 'Will I have to take medication?', a: 'Not necessarily. Treatment is tailored to you and may include therapy, lifestyle support, medication, or a combination.' },
    ],
  },
]

export function getSpecializationBySlug(slug) {
  return SPECIALIZATIONS.find(s => s.slug === slug) || null
}
