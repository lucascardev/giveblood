const express = require("express")
const server = express()

server.use(express.static('public'))
server.use(express.json())
server.use(express.urlencoded({ extended: true }))

const Pool = require('pg').Pool

const db = new Pool({
    user: 'postgres',
    password: 'admin',
    host: 'localhost',
    port: '5432',
    database: 'doe'
})

const nunjucks = require("nunjucks")
nunjucks.configure("./", {
    express: server
})

const VALID_BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]

function normalizeDonorInput(body = {}) {
    return {
        name: String(body.name || "").trim(),
        email: String(body.email || "").trim(),
        phone: String(body.phone || "").trim(),
        city: String(body.city || "").trim(),
        state: String(body.state || "").trim(),
        blood: String(body.blood || "").trim(),
        last_donation_date: String(body.last_donation_date || "").trim(),
        consent_opt_in: body.consent_opt_in === "on" || body.consent_opt_in === "true" || body.consent_opt_in === true
    }
}

function buildCreateDonorQuery(input = {}) {
    return {
        text: `
            INSERT INTO donors ("name", "email", "phone", "city", "state", "blood", "last_donation_date", "eligible_after", "consent_opt_in")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        values: [input.name, input.email, input.phone, input.city, input.state, input.blood, input.last_donation_date, input.eligible_after, input.consent_opt_in]
    }
}

function isValidBloodType(blood) {
    return VALID_BLOOD_TYPES.includes(blood)
}

function computeEligibleAfter(last_donation_date) {
    if (!last_donation_date) return ""

    const donationDate = new Date(`${last_donation_date}T00:00:00.000Z`)
    if (Number.isNaN(donationDate.getTime())) return ""

    const inputDate = String(last_donation_date)
    const normalizedDate = donationDate.toISOString().slice(0, 10)
    if (inputDate !== normalizedDate) return ""

    donationDate.setUTCDate(donationDate.getUTCDate() + 90)
    return donationDate.toISOString().slice(0, 10)
}

function parseBooleanQueryParam(value) {
    if (value === undefined || value === "") return undefined
    if (value === true || value === "true" || value === "1") return true
    if (value === false || value === "false" || value === "0") return false
    return undefined
}

function normalizeDonorSegmentationFilters(query = {}) {
    return {
        blood: String(query.blood || "").trim() || undefined,
        city: String(query.city || "").trim() || undefined,
        state: String(query.state || "").trim() || undefined,
        consent: parseBooleanQueryParam(query.consent),
        eligible: parseBooleanQueryParam(query.eligible)
    }
}

function normalizeUrgentCampaignFilters(query = {}) {
    return {
        blood_type: String(query.blood_type || "").trim() || undefined,
        city: String(query.city || "").trim() || undefined,
        state: String(query.state || "").trim() || undefined
    }
}

function normalizeUrgentCampaignInput(body = {}) {
    const filters = body.filters || {}

    return {
        partner_org_id: String(body.partner_org_id || "").trim(),
        blood_type: String(body.blood_type || "").trim(),
        urgency_level: String(body.urgency_level || "").trim(),
        ends_at: String(body.ends_at || "").trim(),
        description: String(body.description || "").trim(),
        filter_blood_type: String(body.filter_blood_type || filters.blood_type || "").trim(),
        filter_city: String(body.filter_city || filters.city || "").trim(),
        filter_state: String(body.filter_state || filters.state || "").trim(),
        filter_eligibility: body.filter_eligibility || filters.eligibility || null
    }
}

function validateUrgentCampaignInput(input = {}) {
    const errors = []
    const partnerOrgId = Number(input.partner_org_id)
    const urgencyLevel = Number(input.urgency_level)
    const endsAt = new Date(input.ends_at)

    if (!Number.isInteger(partnerOrgId) || partnerOrgId <= 0) errors.push("partner_org_id is required and must be a positive integer")
    if (!isValidBloodType(input.blood_type)) errors.push("blood_type is invalid")
    if (!Number.isInteger(urgencyLevel) || urgencyLevel < 1 || urgencyLevel > 5) errors.push("urgency_level must be an integer between 1 and 5")
    if (!input.ends_at || Number.isNaN(endsAt.getTime())) errors.push("ends_at is required and must be a valid date")
    if (input.filter_blood_type && !isValidBloodType(input.filter_blood_type)) errors.push("filter_blood_type is invalid")
    if (input.filter_state && !/^[A-Za-z]{2}$/.test(input.filter_state)) errors.push("filter_state must be a 2-letter state code")
    if (input.filter_eligibility !== null && typeof input.filter_eligibility !== "object") errors.push("filter_eligibility must be an object")

    return errors
}

function normalizeCreateUrgentCampaignInput(body = {}) {
    return normalizeUrgentCampaignInput(body)
}

function validateCreateUrgentCampaignInput(input = {}) {
    return validateUrgentCampaignInput(input)
}

function normalizePartnerOrgFilters(query = {}) {
    return {
        is_active: parseBooleanQueryParam(query.is_active)
    }
}

function normalizePartnerOrgInput(body = {}) {
    return {
        name: String(body.name || "").trim(),
        contact_email: String(body.contact_email || "").trim(),
        contact_phone: String(body.contact_phone || "").trim(),
        address: String(body.address || "").trim()
    }
}

function validatePartnerOrgInput(input = {}) {
    const errors = []

    if (!input.name) errors.push("name is required")
    if (!input.contact_email && !input.contact_phone) errors.push("contact_email or contact_phone is required")
    if (input.contact_email && !/^\S+@\S+\.\S+$/.test(input.contact_email)) errors.push("contact_email is invalid")

    return errors
}

function buildPartnerOrgsQuery(filters = {}) {
    const conditions = []
    const values = []
    let paramIndex = 1

    if (filters.is_active !== undefined) {
        conditions.push(`is_active = $${paramIndex++}`)
        values.push(filters.is_active)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const query = `SELECT id, "name", contact_email, contact_phone, address, segment_tags, is_active, created_at, updated_at FROM partner_orgs ${whereClause} ORDER BY created_at DESC`
    return { text: query.trim(), values }
}

function buildCreatePartnerOrgQuery(input = {}) {
    return {
        text: `
            INSERT INTO partner_orgs ("name", "contact_email", "contact_phone", "address")
            VALUES ($1, $2, $3, $4)
            RETURNING id, "name", contact_email, contact_phone, address, is_active, created_at
        `,
        values: [input.name, input.contact_email || null, input.contact_phone || null, input.address || null]
    }
}

function normalizeDonationProofInput(body = {}) {
    return {
        donor_id: String(body.donor_id || "").trim(),
        proof_url: String(body.proof_url || "").trim()
    }
}

function validateDonationProofInput(input = {}) {
    const errors = []
    const donorId = Number(input.donor_id)

    if (!Number.isInteger(donorId) || donorId <= 0) errors.push("donor_id is required and must be a positive integer")
    if (!input.proof_url) errors.push("proof_url is required")

    return errors
}

function buildCreateDonationProofQuery(input = {}) {
    return {
        text: `
            INSERT INTO donation_proofs (donor_id, proof_url)
            VALUES ($1, $2)
            RETURNING id, donor_id, proof_url, status, confirmed_at, reward_points, created_at
        `,
        values: [Number(input.donor_id), input.proof_url]
    }
}

function normalizeDonationProofReviewInput(body = {}) {
    return {
        status: String(body.status || "").trim().toLowerCase(),
        reward_points: body.reward_points === undefined || body.reward_points === "" ? 0 : Number(body.reward_points)
    }
}

function validateDonationProofReviewInput(id, input = {}) {
    const errors = []
    const proofId = Number(id)

    if (!Number.isInteger(proofId) || proofId <= 0) errors.push("id must be a positive integer")
    if (!["approved", "rejected"].includes(input.status)) errors.push("status must be approved or rejected")
    if (!Number.isInteger(input.reward_points) || input.reward_points < 0) errors.push("reward_points must be a non-negative integer")

    return errors
}

function buildReviewDonationProofQuery(id, input = {}) {
    const rewardPoints = input.status === "approved" ? input.reward_points : 0

    return {
        text: `
            UPDATE donation_proofs
            SET status = $2,
                confirmed_at = CASE WHEN $2 = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END,
                reward_points = $3
            WHERE id = $1
            RETURNING id, donor_id, proof_url, status, confirmed_at, reward_points, created_at, updated_at
        `,
        values: [Number(id), input.status, rewardPoints]
    }
}

server.get("/", function (req, res) {
    db.query("SELECT * FROM donors", function(err, result) {
         if(err) return res.send("erro no banco de dados.")
         const donors = result.rows
         return res.render("index.html", { donors })
    })

})

server.get("/api/donors/segments", function (req, res) {
    const filters = normalizeDonorSegmentationFilters(req.query)
    const query = buildDonorSegmentationQuery(filters)

    db.query(query, function(err, result) {
        if (err) return res.status(500).json({ error: "Erro no banco de dados." })
        return res.json({ donors: result.rows })
    })
})

server.get("/api/campaigns/urgent", function (req, res) {
    const filters = normalizeUrgentCampaignFilters(req.query)
    const query = buildUrgentCampaignsQuery(filters)

    db.query(query, function(err, result) {
        if (err) return res.status(500).json({ error: "Erro no banco de dados." })
        return res.json({ campaigns: result.rows })
    })
})

server.post("/api/campaigns/urgent", function (req, res) {
    const input = normalizeUrgentCampaignInput(req.body)
    const errors = validateUrgentCampaignInput(input)

    if (errors.length > 0) {
        return res.status(400).json({ errors })
    }

    const query = buildCreateUrgentCampaignQuery(input)

    db.query(query, function(err, result) {
        if (err) return res.status(500).json({ error: "Erro no banco de dados." })
        return res.status(201).json({ campaign: result.rows[0] })
    })
})

server.get("/api/partner-orgs", function (req, res) {
    const filters = normalizePartnerOrgFilters(req.query)
    const query = buildPartnerOrgsQuery(filters)

    db.query(query, function(err, result) {
        if (err) return res.status(500).json({ error: "Erro no banco de dados." })
        return res.json({ partner_orgs: result.rows })
    })
})

server.post("/api/partner-orgs", function (req, res) {
    const input = normalizePartnerOrgInput(req.body)
    const errors = validatePartnerOrgInput(input)

    if (errors.length > 0) {
        return res.status(400).json({ errors })
    }

    const query = buildCreatePartnerOrgQuery(input)

    db.query(query, function(err, result) {
        if (err) return res.status(500).json({ error: "Erro no banco de dados." })
        return res.status(201).json({ partner_org: result.rows[0] })
    })
})

server.post("/api/donation-proofs", function (req, res) {
    const input = normalizeDonationProofInput(req.body)
    const errors = validateDonationProofInput(input)

    if (errors.length > 0) {
        return res.status(400).json({ errors })
    }

    const query = buildCreateDonationProofQuery(input)

    db.query(query, function(err, result) {
        if (err) return res.status(500).json({ error: "Erro no banco de dados." })
        return res.status(201).json({ donation_proof: result.rows[0] })
    })
})

server.patch("/api/donation-proofs/:id/review", function (req, res) {
    const input = normalizeDonationProofReviewInput(req.body)
    const errors = validateDonationProofReviewInput(req.params.id, input)

    if (errors.length > 0) {
        return res.status(400).json({ errors })
    }

    const query = buildReviewDonationProofQuery(req.params.id, input)

    db.query(query, function(err, result) {
        if (err) return res.status(500).json({ error: "Erro no banco de dados." })
        if (result.rows.length === 0) return res.status(404).json({ error: "Donation proof not found." })
        return res.json({ donation_proof: result.rows[0] })
    })
})

server.post("/", function (req, res) {
    const { name, email, phone, city, state, blood, last_donation_date, consent_opt_in } = normalizeDonorInput(req.body)
    if (name == "" || email == "" || phone == "" || city == "" || state == "" || blood == "" || last_donation_date == "") {
        return res.send("Todos os campos são obrigatórios.")
    }

    if (!consent_opt_in) {
        return res.send("Consentimento é obrigatório.")
    }

    if (!isValidBloodType(blood)) {
        return res.send("Tipo sanguíneo inválido.")
    }

    const eligible_after = computeEligibleAfter(last_donation_date)
    if (eligible_after == "") {
        return res.send("Data da última doação inválida.")
    }

    const query = buildCreateDonorQuery({ name, email, phone, city, state, blood, last_donation_date, eligible_after, consent_opt_in })

    db.query(query, function(err) {
        if (err) return res.send("Erro no banco de dados.")
        return res.redirect("/")
    })


})

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, function () {
        console.log("inicei o servidor na porta " + PORT);
    });
}

function buildDonorSegmentationQuery(filters = {}) {
    const { blood, city, state, consent, eligible } = filters
    const conditions = []
    const values = []
    let paramIndex = 1

    if (blood) {
        conditions.push(`blood = $${paramIndex++}`)
        values.push(blood)
    }
    if (city) {
        conditions.push(`city ILIKE $${paramIndex++}`)
        values.push(city)
    }
    if (state) {
        conditions.push(`state ILIKE $${paramIndex++}`)
        values.push(state)
    }
    if (consent !== undefined) {
        conditions.push(`consent_opt_in = $${paramIndex++}`)
        values.push(consent)
    }
    if (eligible !== undefined) {
        if (eligible) {
            conditions.push(`(eligible_after IS NULL OR eligible_after <= CURRENT_DATE)`)
        } else {
            conditions.push(`eligible_after IS NOT NULL AND eligible_after > CURRENT_DATE`)
        }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const baseQuery = `SELECT * FROM donors`
    const query = whereClause ? `${baseQuery} ${whereClause} ORDER BY created_at DESC` : `${baseQuery} ORDER BY created_at DESC`
    return { text: query, values }
}

function buildUrgentCampaignsQuery(filters = {}) {
    const { blood_type, city, state } = filters
    const conditions = ["is_active = TRUE"]
    const values = []
    let paramIndex = 1

    if (blood_type) {
        conditions.push(`blood_type = $${paramIndex++}`)
        values.push(blood_type)
    }
    if (city) {
        conditions.push(`filter_city ILIKE $${paramIndex++}`)
        values.push(city)
    }
    if (state) {
        conditions.push(`filter_state ILIKE $${paramIndex++}`)
        values.push(state)
    }

    const query = `SELECT * FROM urgent_stock_campaigns WHERE ${conditions.join(" AND ")} ORDER BY urgency_level DESC, created_at DESC`
    return { text: query, values }
}

function buildCreateUrgentCampaignQuery(input = {}) {
    return {
        text: `
            INSERT INTO urgent_stock_campaigns (
                partner_org_id,
                blood_type,
                urgency_level,
                ends_at,
                description,
                filter_blood_type,
                filter_city,
                filter_state,
                filter_eligibility
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `,
        values: [
            Number(input.partner_org_id),
            input.blood_type,
            Number(input.urgency_level),
            new Date(input.ends_at).toISOString(),
            input.description || null,
            input.filter_blood_type || null,
            input.filter_city || null,
            input.filter_state ? input.filter_state.toUpperCase() : null,
            input.filter_eligibility ? JSON.stringify(input.filter_eligibility) : null
        ]
    }
}

module.exports = {
    server,
    normalizeDonorInput,
    isValidBloodType,
    computeEligibleAfter,
    normalizeDonorSegmentationFilters,
    normalizeUrgentCampaignFilters,
    normalizeUrgentCampaignInput,
    validateUrgentCampaignInput,
    normalizeCreateUrgentCampaignInput,
    validateCreateUrgentCampaignInput,
    buildCreateUrgentCampaignQuery,
    normalizePartnerOrgFilters,
    buildPartnerOrgsQuery,
    normalizePartnerOrgInput,
    validatePartnerOrgInput,
    buildCreatePartnerOrgQuery,
    normalizeDonationProofInput,
    validateDonationProofInput,
    buildCreateDonationProofQuery,
    normalizeDonationProofReviewInput,
    validateDonationProofReviewInput,
    buildReviewDonationProofQuery,
    buildDonorSegmentationQuery,
    buildUrgentCampaignsQuery,
    buildCreateDonorQuery,
    VALID_BLOOD_TYPES
}
