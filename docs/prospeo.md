<!-- Source: https://prospeo.io/api-docs -->

---
title: Prospeo REST API
sidebarTitle: API Introduction
timestamp: 1781144323000
---

# Prospeo REST API

Our fast and stable API is designed to be integrated in minutes.

*   Simple and clear `JSON` responses
*   Fast response time & consistent responses format
*   Simple auth & easy-to-understand error handling
*   Free API access for all users

## Get Started

*   [Authentication & format](/api-docs/authentication) - Authenticate your requests and understand the required format
*   [Rate limits](/api-docs/rate-limits) - Understand our rate limiting to avoid service interruption

## Enrichment endpoints

*   [Enrich Person](/api-docs/enrich-person) - Enrich a lead with their verified email, mobile and all their accurate B2B data.
*   [Bulk Enrich Person](/api-docs/bulk-enrich-person) - Enrich up to 50 leads at once with their contact info & profile data.
*   [Enrich Company](/api-docs/enrich-company) - Enrich a company with their accurate and up-to-date data: funding, technologies, and 50+ data points.
*   [Bulk Enrich Company](/api-docs/bulk-enrich-company) - Enrich up to 50 companies at once with all of their data.

## Search endpoints

*   [Search Person](/api-docs/search-person) - Leverage our powerful database and search through 200M+ contacts with 30+ filters.
*   [Search Company](/api-docs/search-company) - Leverage our database and search through 30M+ companies.

## Other endpoints

*   [Search Suggestions](/api-docs/search-suggestions) - Programmatically retrieve valid filter values: locations, job titles, technologies, and more.
*   [Account Information](/api-docs/account-information) - Track your usage, next renewal date, and more.

<!-- Source: https://prospeo.io/api-docs/authentication -->

---
title: Authentication API - Prospeo
sidebarTitle: Authentication
timestamp: 1781144323000
---

import { Callout } from 'nextra/components'
import { Tabs } from 'nextra/components'

Authentication
===========

To authenticate with the Prospeo API, add the header `X-KEY` to your request.<br></br>
You can find your API key on your [dashboard](https://app.prospeo.io/api).
You have the ability to create multiple API keys.

Request
===========

* The host is `api.prospeo.io`
* All requests should be made with HTTPS
* All of our endpoints accept the `POST` method only, except [Account Information](/api-docs/account-information) which uses `GET`

<Callout type="warning" emoji="⚠️">
    You are required to add the header `Content-Type: application/json`
</Callout>

Below are minimal example of our [Enrich Person API](/api-docs/enrich-person).

<Tabs items={['cURL', 'Python', 'PHP', 'JavaScript', 'Laravel w/ Guzzle']}>
<Tabs.Tab>
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-KEY: your_api_key" \
  -d '{
        "only_verified_email": true,
        "enrich_mobile": false,
        "data": {
            "first_name": "John",
            "last_name": "Doe",
            "company_website": "intercom.com"
        }
    }' \
  "https://api.prospeo.io/enrich-person"
```
</Tabs.Tab>
<Tabs.Tab>
```python
import requests

url = "https://api.prospeo.io/enrich-person"
api_key = "your_api_key"

required_headers = {
    'Content-Type': 'application/json',
    'X-KEY': api_key
}

data = {
    'only_verified_email': True,
    'enrich_mobile': False,
    'data': {
        'first_name': 'John',
        'last_name': 'Doe',
        'company_website': 'intercom.com'
    }
}

response = requests.post(url, json=data, headers=required_headers)
```
</Tabs.Tab>
<Tabs.Tab>
```php
$url = "https://api.prospeo.io/enrich-person";
$api_key = "your_api_key";

$headers = array(
    "Content-Type" => "application/json",
    "X-KEY" => $api_key
);

$data = array(
    "first_name" => "John",
    "last_name" => "Doe",
    "company_website" => "intercom.com"
);

$param = array(
    "only_verified_email" => true,
    "enrich_mobile" => false,
    "data" => $data
);

$options = array(
    CURLOPT_URL => $url,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_POSTFIELDS => json_encode($param),
    CURLOPT_RETURNTRANSFER => true
);

$ch = curl_init();
curl_setopt_array($ch, $options);
$response = curl_exec($ch);
curl_close($ch);
```
</Tabs.Tab>
<Tabs.Tab>
```javascript
const url = "https://api.prospeo.io/enrich-person";
const apiKey = "your_api_key";

const requiredHeaders = {
    "Content-Type": "application/json",
    "X-KEY": apiKey
};

const data = {
    only_verified_email: true,
    enrich_mobile: false,
    data: {
        first_name: 'John',
        last_name: 'Doe',
        company_website: 'intercom.com'
    }
}

fetch(url, {
    method: "POST",
    headers: requiredHeaders,
    body: JSON.stringify(data)
})
.then(response => response.json())
.then(console.log);
```
</Tabs.Tab>
<Tabs.Tab>
```php
use GuzzleHttp\Client;

$url = "https://api.prospeo.io/enrich-person";
$api_key = "your_api_key";

$headers = [
    "Content-Type" => "application/json",
    "X-KEY" => $api_key
];

$data = [
    "only_verified_email" => true,
    "enrich_mobile" => false,
    "data" => [
        "first_name" => "John",
        "last_name" => "Doe",
        "company_website" => "intercom.com"
    ]
];

$client = new Client();
$response = $client->post($url, [
    "headers" => $headers,
    "json" => $data
]);

$body = $response->getBody();
```
</Tabs.Tab>
</Tabs>

Response
===========

<Callout   type="info">
    Read the error handling section of the endpoint page you need to handle errors.
</Callout>

* All the response will be in `JSON`.
* Each response will always contain an `error` property: `false` if the request was successful, `true` otherwise
* Response codes:
    * **`200`** : Valid request
    * **`400`** : An error occurred, including invalid API key (`INVALID_API_KEY` error code)
    * **`429`** : Rate limit exceeded

## Example of a successful response ([Enrich Person API](/api-docs/enrich-person))

This response contains a revealed mobile (`enrich_mobile`:`true`).

```json
{
    "error": false,
    "free_enrichment": false,
    "person": {
        "person_id": "aaaacd817619fba3d254cd64",
        "first_name": "Eoghan",
        "last_name": "Mccabe",
        "full_name": "Eoghan Mccabe",
        "linkedin_url": "https://www.linkedin.com/in/eoghanmccabe",
        "current_job_title": "CEO, chairman, and co-founder",
        "current_job_key": null,
        "headline": "CEO and founder at Intercom, building Fin.ai",
        "linkedin_member_id": null,
        "last_job_change_detected_at": null,
        "job_history": [
            {
                "title": "CEO, chairman, and co-founder",
                "company_name": "Intercom",
                "logo_url": "9ded0364-c88a-4789-9d39-2a15ed239edb.jpg",
                "current": true,
                "start_year": 2022,
                "start_month": 10,
                "end_year": null,
                "end_month": null,
                "duration_in_months": 39,
                "departments": [
                    "Founder",
                    "Chief Executive"
                ],
                "seniority": "C-Suite",
                "company_id": "cccc7c7da6116a8830a07100",
                "job_key": "82981650"
            },
            {
                "title": "Chairman and co-founder",
                "company_name": "Intercom",
                "logo_url": "9ded0364-c88a-4789-9d39-2a15ed239edb.jpg",
                "current": false,
                "start_year": 2020,
                "start_month": 7,
                "end_year": 2022,
                "end_month": 10,
                "duration_in_months": 27,
                "departments": [
                    "Founder"
                ],
                "seniority": "Founder/Owner",
                "company_id": "cccc7c7da6116a8830a07100",
                "job_key": "23054356"
            },
            {
                "title": "CEO and co-founder",
                "company_name": "Intercom",
                "logo_url": "9ded0364-c88a-4789-9d39-2a15ed239edb.jpg",
                "current": false,
                "start_year": 2011,
                "start_month": 8,
                "end_year": 2020,
                "end_month": 7,
                "duration_in_months": 107,
                "departments": [
                    "Founder",
                    "Chief Executive"
                ],
                "seniority": "C-Suite",
                "company_id": "cccc7c7da6116a8830a07100",
                "job_key": "68686694"
            },
            {
                "title": "CEO",
                "company_name": "Exceptional",
                "logo_url": "2588d75e-d2e7-4fb1-bf31-35cafd119ec0.jpg",
                "current": false,
                "start_year": 2008,
                "start_month": 10,
                "end_year": 2011,
                "end_month": 7,
                "duration_in_months": 33,
                "departments": [
                    "Chief Executive"
                ],
                "seniority": "C-Suite",
                "company_id": "ccccd431f3dfa7e88993bb18",
                "job_key": "80900834"
            },
            {
                "title": "CEO",
                "company_name": "Contrast",
                "logo_url": "d4bbee3f-7128-436d-a474-fcac68b989e4.jpg",
                "current": false,
                "start_year": 2007,
                "start_month": 12,
                "end_year": 2011,
                "end_month": 7,
                "duration_in_months": 43,
                "departments": [
                    "Chief Executive"
                ],
                "seniority": "C-Suite",
                "company_id": "ccccf3e7f023592ee266a9d8",
                "job_key": "72014547"
            }
        ],
        "mobile": {
            "status": "VERIFIED",
            "revealed": false,
            "mobile": "+1 415-3**-****",
            "mobile_national": "(415) 3**-****",
            "mobile_international": "+1 415-3**-****",
            "mobile_country": "United States",
            "mobile_country_code": "US"
        },
        "email": {
            "status": "VERIFIED",
            "revealed": true,
            "email": "eoghan.*****@intercom.com",
            "verification_method": "BOUNCEBAN",
            "email_mx_provider": "Google"
        },
        "location": {
            "country": "United States",
            "country_code": "US",
            "state": "California",
            "city": "San Francisco",
            "time_zone": "America/Los_Angeles",
            "time_zone_offset": -7.0
        },
        "skills": []
    },
	"company": {
		"company_id": "cccc7c7da6116a8830a07100",
		"name": "Intercom",
		"website": "https://intercom.com",
		"domain": "intercom.io",
		"other_websites": [],
		"description": "Intercom is the only complete AI-first customer service platform, enhancing the customer experience, improving operational efficiency, and scaling with your business every step of the way. \n\nOur AI-first platform is built on a single AI system, with two major components that will allow you to deliver the remarkable customer service you’ve spent decades striving for:\n\nFin AI Agent: The human-quality AI agent that works with any Helpdesk\n\nIntercom Customer Service Platform: The AI-first platform trusted by thousands of support leaders.  \n\nFounded in 2011 and backed by leading venture capitalists, including Kleiner Perkins, Bessemer Venture Partners and Social Capital, Intercom believes there's a new way to do customer service.",
		"description_seo": "Intercom is the complete AI-first customer service solution, giving exceptional experiences for support teams with AI agent, AI copilot, tickets, phone & more",
		"description_ai": "Intercom is an AI-first customer service solution that provides exceptional experiences for support teams with AI agent, AI copilot, tickets, phone, and more.",
		"type": "Private",
		"industry": "Software Development",
		"employee_count": 1822,
		"employee_count_on_prospeo": 437,
		"employee_range": "1001-2000",
		"location": {
			"country": "United States",
			"country_code": "US",
			"state": "California",
			"city": "San Francisco",
			"raw_address": "55 2nd Street, 4th Floor, San Francisco, California 94105, US"
		},
		"sic_codes": [
			"737"
		],
		"naics_codes": [],
		"email_tech": {
			"domain": "intercom.io",
			"mx_provider": "Google"
		},
		"linkedin_url": "https://www.linkedin.com/company/intercom",
		"twitter_url": "https://x.com/intercom",
		"facebook_url": "https://www.facebook.com/intercominc",
		"crunchbase_url": "https://www.crunchbase.com/organization/intercom",
		"instagram_url": "https://www.instagram.com/intercom",
		"youtube_url": "https://www.youtube.com/c/@intercominc",
		"phone_hq": {
			"phone_hq": "+14156733820",
			"phone_hq_national": "(415) 673-3820",
			"phone_hq_international": "+14156733820",
			"phone_hq_country": "United States",
			"phone_hq_country_code": "US"
		},
		"linkedin_id": null,
		"founded": 2011,
		"revenue_range": {
			"min": 100000000,
			"max": 250000000
		},
		"revenue_range_printed": "100M",
		"keywords": [
			"Customer Support",
			"Live Chat",
			"Marketing Automation",
			"Customer Relationship Management",
			"Customer Experience",
			"Customer Engagement",
			"Customer Service",
			"Mobile",
			"Customer Feedback",
			"AI",
			"Helpdesk",
			"CX",
			"Chat Bots",
			"Customer Communication",
			"Support Automation",
			"Shared Inbox"
		],
		"logo_url": "https://prospeo-static-assets.s3.us-east-1.amazonaws.com/company_logo/9ded0364-c88a-4789-9d39-2a15ed239edb.jpg",
		"attributes": {
			"is_b2b": true,
			"has_demo": false,
			"has_free_trial": true,
			"has_downloadable": false,
			"has_mobile_apps": false,
			"has_online_reviews": true,
			"has_pricing": true
		},
		"funding": {
			"count": 2,
			"total_funding": 125000000,
			"total_funding_printed": "$125.0M",
			"latest_funding_date": "2021-01-01T00:00:00",
			"latest_funding_stage": "Series unknown",
			"funding_events": [
				{
					"amount": null,
					"amount_printed": null,
					"raised_at": "2021-01-01T00:00:00",
					"stage": "Series unknown",
					"link": "https://www.crunchbase.com/funding_round/intercom-series-unknown--6ce20dfb"
				},
				{
					"amount": 125000000,
					"amount_printed": "$125,000,000",
					"raised_at": "2018-04-27T00:00:00",
					"stage": "Series D",
					"link": "https://www.crunchbase.com/funding_round/intercom-series-d--15490ce6"
				}
			]
		},
		"technology": {
			"count": 43,
			"technology_names": [
				"6sense",
				"theTradeDesk",
				"Amazon SES",
				"Contentful",
				"Node.js",
				"Tailwind CSS"
			],
			"technology_list": [
				{
					"name": "6sense",
					"category": "Marketing automation"
				},
				{
					"name": "theTradeDesk",
					"category": "Advertising"
				},
				{
					"name": "Amazon SES",
					"category": "Email"
				},
				{
					"name": "Contentful",
					"category": "CMS"
				}
			]
		},
		"job_postings": {
			"active_count": 3,
			"active_titles": [
				"account executive, senior midmarket",
				"senior product engineer",
				"senior recruiting coordinator"
			]
		}
	}
}
```

## Example of an error response
```json
{
    "error": true,
    "error_code": "NO_MATCH"
}
```
<!-- Source: https://prospeo.io/api-docs/rate-limits -->

---
title: Rate limits - Prospeo API
sidebarTitle: Rate limits
timestamp: 1777857006000
---

import { Callout } from 'nextra/components'
import { Tab, Tabs } from 'nextra/components'
import Image from 'next/image'

Rate limits
===========

Each endpoint is capped by a rate limit to prevent abuse.

* The rate limits depends on your team's plan. [More details on our pricing page, below each plan.](https://prospeo.io/pricing)
* You can track your rate-limit usage in real-time from [your dashboard here.](https://app.prospeo.io/api)

The rate limit is divided in 2 categories, each tracked independently:

*	**Enrich endpoints** — `/enrich-person`, `/enrich-company`, `/bulk-enrich-person`, `/bulk-enrich-company`

| | Starter | Growth | Pro |
|---|---|---|---|
| Per second | 5 | 5 | 30 |
| Per minute | 300 | 300 | 1,800 |
| Per day | 2,000 | 5,000 | 500,000 |

*	**Search endpoints** — `/search-person`, `/search-company`

Search endpoints use significantly more server resources than enrichment, so they have lower rate limits.

| | Starter | Growth | Pro |
|---|---|---|---|
| Per second | 1 | 2 | 5 |
| Per minute | 30 | 60 | 180 |
| Per day | 1,000 | 4,000 | 250,000 |

#### Track from the dashboard
<br/>
<Image
  src={'/images/rate-limit.png'}
  alt="Rate limit usage chart"
  width="2026"
  height="698"
/>

You can easily track in real-time your rate limit usage per endpoint category.

#### Track from the response

You can keep track of your rate limit on the current endpoint category by reading our response headers:

* `x-daily-request-left`: Remaining requests for the day
* `x-minute-request-left`: Remaining requests for the minute
* `x-daily-reset-seconds`: Seconds until daily limit resets
* `x-minute-reset-seconds`: Seconds until minute limit resets
* `x-daily-rate-limit`: Total daily request limit
* `x-minute-rate-limit`: Total minute request limit
* `x-second-rate-limit`: Total per-second request limit

When the limit is reached, we will return a `429` error code.

If you need your rate limit to be increased, you can easily do so by upgrading your plan. Our largest plan offers very generous rate limits.

<!-- Source: https://prospeo.io/api-docs/search-person -->

---
title: Search Person API - Prospeo
sidebarTitle: Search Person API
timestamp: 1785349920000
---

import { Callout } from 'nextra/components'
import { Tabs } from 'nextra/components'
import { Steps } from 'nextra/components'

Search for leads
===========

This endpoint allows you to perform a precise search against our extensive up-to-date database of contacts and build leads lists.

We offer more than 20 filters that can be used to craft your perfect leads list.

This endpoint does not returns the `email` and `mobile` of the persons.

To enrich `email` and `mobile` from this endpoint, you can:
	* submit a `person_id` you get from the search result to our Enrich Person endpoint.
	* submit all of the `person_id` you get from the search result to our Bulk Enrich Person endpoint. [Click here for more info about this process](/api-docs/enrich-person#enrich-records-from-our-search-api)

In order to keep Prospeo's infrastructure efficient, the maximum amount of results you can pull using this API is **25,000** (1000 pages of 25 results).

## How are credits spent?

    *   1 credit is spent per search request that returns at least one person.
    *   There are 25 results per page, hence 1 credit is spent for a maximum of 25 results.
    *   **Deduplication:** If your team has already paid for the exact same page of results, subsequent requests returning the same result set will be free. The response will include `"free": true` to indicate no credit was charged. This deduplication window lasts **30 days**.

## Endpoint

    *   URL: https://api.prospeo.io/search-person
    *   Method: `POST`
    *   Headers:
        - `X-KEY`: `your_api_key`
        - `Content-Type`: `application/json`


## Parameters

| Parameter | Example value          | Description                                        |
| :--------- | :--------------- | :--------------------------------------------- |
| **`filters`**<br></br><sup>required</sup> | `{...}` | The complete filter configuration you want to use. See the [Filters Documentation](/api-docs/filters-documentation) or the [filter section below](#filters) for all details. |
| **`page`**<br></br><sup>optional</sup> | `1` | The page you want to query for your search. Always defaults to `1` if no page is used. |

## How to perform a search?

There are two ways to build your search filters:

1. **Dashboard UI helper** - Use our dashboard to visually build your search and export the JSON payload (described below)
2. **Filters Documentation** - Refer to our complete [Filters Documentation](/api-docs/filters-documentation) for all available filters and their values

### Using the dashboard helper

<Steps>
### Step 1
 
Head to our dashboard and build a search with various filters.
 
### Step 2
 
Click on the `...` in the top-right corner of the search results, and click on **Search API**.

### Step 3

A modal will open with the current search payload you built. By using this tool, you can understand what filters does what, and how it is represented through the API.

### Step 4

You can copy the payload and directly re-use it in your request. Here is the example of a request for quick understanding:

```json 
curl --location 'https://api.prospeo.io/search-person' \
--header 'X-KEY: your_api_key' \
--header 'Content-Type: application/json' \
--data '{
    "page": 1,
    "filters": {
        "company_industry": {
            "exclude": [
                "Semiconductors",
                "Pet Services"
            ]
        },
        "person_seniority": {
            "include": [
                "Founder/Owner"
            ]
        },
        "person_year_of_experience": {
            "min": 10,
            "max": 50
        }
    }
}'
```

Example of a failed request:

```json
{
    "error": true,
	"error_code": "INVALID_FILTERS",
	"filter_error": "Invalid industry(s) in include list: ['Accountingg']"
}
```

The response will contain the results.

Each result will contain:
	* a `person` object (see the [Person object page](/api-docs/person-object) for the complete schema)
	* if that person has a current job, its corresponding `company` data (see the [Company object page](/api-docs/company-object) for the complete schema)

<Callout type="warning">
    The `mobile` and `email` properties of the person are present in the response but never contain the revealed values. Use our Enrich person endpoint to reveal/access those. [Click here for more info about this process](/api-docs/enrich-person#enrich-records-from-our-search-api)
</Callout>

```json
{
    "error": false,
	"free": false,
	"results": [
		{
			"person": ...
			"company": ...
		},
		{
			"person": ...
			"company": ...
		},
		{
			"person": ...
			"company": ...
		},
		... up to 25 per page
	],
	"pagination": {
		"current_page": 1,
		"per_page": 25,
		"total_page": 11,
		"total_count": 271
	}
}
```

### Final note:

* There are additional search filters available through our API that are not available on the dashboard. [Those are: company.names and company.websites. They allow you to pre-filter on a list of companies. More info below.](/api-docs/search-person#search-from-a-list-of-company-websites-or-names)
* The dashboard's Company filter builds a `company.company_oids` filter. This **is** supported by `/search-person` — see [Filter on a specific list of companies](/api-docs/search-person#filter-on-a-specific-list-of-companies) below. Older versions of the payload export stripped it out; if your exported payload has no company filter but the dashboard showed one, add the `company.company_oids` block back and you will get identical results.
* Two dashboard-only filters have no public equivalent, because they reference objects that only exist inside the dashboard: `company.company_list_oids` (a saved company list) and `company.temp_matching_oids` (a CSV/selection matching session). Use `company.company_oids`, `company.names` or `company.websites` instead.

</Steps>

## Paginate the results

You can use the `page` parameter to go paginate the complete result set. The maximum pages is always 1000 when using our API. Use the `pagination` in response to see how many pages exists.

## Response details

| Property | Type | Description |
| :----- | :---- | :---------- |
| `error` | boolean | Indicates if an error has occurred. If `false`, the request was successful. If `true`, an error has occurred and a `error_code` property will be present. See below.  |
| `free` | boolean | Indicates whether this request was free due to deduplication. `true` if your team has already paid for this exact result set within the last 30 days, `false` otherwise. |
| `results` | list | Contains the current page of results. Up to 25 records per page. |
| `pagination` | object | Contains the information about the pagination. Use it to know if you can turn to the next page. |

## Error codes

| HTTP code | `error_code` property          | Meaning                                        |
| :--------- | :--------------- | :--------------------------------------------- |
| **`400`**  | `INVALID_FILTERS` | The filter configuration you used is not supported. See the `filter_error` property for more details. |
| **`400`**  | `PLAN_REQUIRED`   | One or more filters in your request require a higher plan than your current subscription. The `filter_error` property lists each rejected filter and its minimum plan (e.g. `company_key_execs (PRO+)`). See the [Filters Documentation](/api-docs/filters-documentation) for the minimum plan of each filter. |
| **`400`**  | `NO_RESULTS`  | There was no results matching your filters. |
| **`400`**  | `INSUFFICIENT_CREDITS` | You do not have enough credit to perform the request. |
| **`400`**  | `INVALID_API_KEY`     | Invalid API key, check your `X-KEY` header. |
| **`429`**  | `Rate limit exceeded`        | You hit the rate limit for your current plan.  |
| **`400`**  | `INVALID_REQUEST`  | The request your submitted is invalid.  |
| **`400`**  | `SERVICE_TEMPORARILY_UNAVAILABLE`  | A temporary issue occurred on our side, retry the request after a short delay. |
| **`400`**  | `INTERNAL_ERROR`  | An error occurred on our side, please contact the support. |

## Filters

To understand how to use our filters, you have two options:

*	**Filters Documentation** - Refer to our complete [Filters Documentation](/api-docs/filters-documentation) for all available filters, their types, and accepted values.
*	**Dashboard UI** - Use our dashboard UI as [described here](/api-docs/search-person#how-to-perform-a-search) to visually build your search and see the generated payload.

Keep in mind that it is not allowed to perform a search solely with `exclude` filters for performance reasons.

#### Search from a list of company websites or names

There is no option in the UI builder to search using a list of company websites or names. This API still allows you to perform searches using those elements.

<Callout type="info">
	The maximum size is **500** websites or names at once.
</Callout>

```json
{
	"page": 1,
	"filters": {
		"company": {
			"websites": {
				"include": [
					"deloitte.com",
					"https://facebook.com/"
				]
			},
			"names": {
				"include": [
					"Walmart",
					"Microsoft"
				]
			}
		}
    }
}
```

#### Filter on a specific list of companies

When you pick companies in the dashboard's **Company** filter, the dashboard resolves each one to its Prospeo company ID and sends `company.company_oids`. This filter is fully supported by `/search-person`: it returns only people whose **current** employer is one of the given companies.

Use it when `company.names` is too loose — a name match can pull in unrelated companies that share a name, whereas a company ID matches exactly one company.

You get company IDs from the `company_id` field of any `company` object we return — from `/search-company` results, from `/search-person` results, or from company enrichment. See the [Company object](/api-docs/company-object) page.

<Callout type="info">
	`include` and `exclude` are both supported. The combined total of `company_oids`, `company_list_oids` and `temp_matching_oids` values must not exceed **5,000**.
</Callout>

```json
{
	"page": 1,
	"filters": {
		"person_job_title": {
			"include": ["account executive"],
			"match_mode": "CONTAINS"
		},
		"company": {
			"company_oids": {
				"include": [
					"cccc7c7da6116a8830a07100",
					"cccc7c7da6116a8830a07101"
				]
			}
		}
    }
}
```

<Callout type="warning">
	`company.company_oids` is only available on `/search-person`. It is rejected with `INVALID_FILTERS` on `/search-company` — to search for specific companies there, use `company.names` or `company.websites`.
</Callout>

#### ENUM filter values

Many filters are linked to an ENUM, which means that we accept a set list of values.

Below is the list of all the values allowed per filter:

*	person_department: [Departments](/api-docs/enum/departments)
*	person_seniority: [Seniorities](/api-docs/enum/seniorities)
*	company_industry: [Industries](/api-docs/enum/industries)
*	company_headcount_range: [Employee ranges](/api-docs/enum/employee-ranges)
*	company_funding: [Funding stages](/api-docs/enum/funding-stages)
*	company_technology: [Technologies](/api-docs/enum/technologies)
*	company_email_provider: [MX providers](/api-docs/enum/mx-providers)
*	company_naics: [Search Suggestions API](/api-docs/search-suggestions)
*	company_sics: [Search Suggestions API](/api-docs/search-suggestions)

#### Location filter values

As it can be seen on the dashboard, the `company_location_search` and the `person_location_search` both takes strings as values.

In order to ensure accuracy, the `location` strings you submit must match exactly the one you can pull from the dashboard.

We do not accept arbitrary location string such as "nyc".

<Callout type="info">
	**Programmatic access:** Use our [Search Suggestions API](/api-docs/search-suggestions) to programmatically retrieve valid location values. This endpoint allows you to search for locations and get properly formatted strings that can be used directly in your filters.
</Callout>

Alternatively, build a list of location by inserting them on the filter on the dashboard, look at the generated payload, and re-use those values.

#### Job title filter values

The `person_job_title` filter takes strings as values.

<Callout type="info">
	**Programmatic access:** Use our [Search Suggestions API](/api-docs/search-suggestions) to programmatically retrieve valid job title values. This endpoint returns up to 25 job titles ordered by popularity.
</Callout>

Alternatively, build a list of job titles by inserting them on the filter on the dashboard, look at the generated payload, and re-use those values.

## Rate limit

See our [rate limits page.](/api-docs/rate-limits)

<!-- Source: https://prospeo.io/api-docs/search-company -->

---
title: Search Company API - Prospeo
sidebarTitle: Search Company API
timestamp: 1785349920000
---

import { Callout } from 'nextra/components'
import { Tabs } from 'nextra/components'
import { Steps } from 'nextra/components'

Search for companies
===========

This endpoint allows you to perform a precise search against our extensive up-to-date database of companies and build account lists.

We offer more than 20 filters that can be used to craft your perfect company list.

In order to keep Prospeo's infrastructure efficient, the maximum amount of results you can pull using this API is **25,000** (1000 pages of 25 results).

## How are credits spent?

    *   1 credit is spent per search request that returns at least one company.
    *   There are 25 results per page, hence 1 credit is spent for a maximum of 25 results.
    *   **Deduplication:** If your team has already paid for the exact same page of results, subsequent requests returning the same result set will be free. The response will include `"free": true` to indicate no credit was charged. This deduplication window lasts **30 days**.

## Endpoint

    *   URL: https://api.prospeo.io/search-company
    *   Method: `POST`
    *   Headers:
        - `X-KEY`: `your_api_key`
        - `Content-Type`: `application/json`

## Parameters

| Parameter | Example value          | Description                                        |
| :--------- | :--------------- | :--------------------------------------------- |
| **`filters`**<br></br><sup>required</sup> | `{...}` | The complete filter configuration you want to use. See the [Filters Documentation](/api-docs/filters-documentation) or the [filter section below](#filters) for all details. |
| **`page`**<br></br><sup>optional</sup> | `1` | The page you want to query for your search. Always defaults to `1` if no page is used. |

## How to perform a search?

There are two ways to build your search filters:

1. **Dashboard UI helper** - Use our dashboard to visually build your search and export the JSON payload (described below)
2. **Filters Documentation** - Refer to our complete [Filters Documentation](/api-docs/filters-documentation) for all available filters and their values

### Using the dashboard helper

<Steps>
### Step 1
 
Head to our dashboard and build a company search with various filters (ensure to be on the company search page).
 
### Step 2
 
Click on the `...` in the top-right corner of the search results, and click on **Search API**.

### Step 3

A modal will open with the current search payload you built. By using this tool, you can understand what filters does what, and how it is represented through the API.

### Step 4

You can copy the payload and directly re-use it in your request. Here is the example of a request for quick understanding:

```json 
curl --location 'https://api.prospeo.io/search-company' \
--header 'X-KEY: api-key' \
--header 'Content-Type: application/json' \
--data '{
    "page": 1,
    "filters": {
        "company_industry": {
            "exclude": [
                "Semiconductors",
                "Pet Services"
            ]
        },
        "company_funding": {
			"stage": [
				"Series B", 
				"Series C"
			],
			"funding_date": 365,
			"last_funding": {
				"min": "1M", 
				"max": "10M"
			},
			"total_funding": {
				"min": "10M", 
				"max": "100M"
			}
    	}
    }
}'
```

The response will contain the results.

Each result will contain a `company` object (see the [Company object page](/api-docs/company-object) for the complete schema)

```json
{
    "error": false,
	"free": false,
	"results": [
		{
			"company": ...
		},
		{
			"company": ...
		},
		{
			"company": ...
		},
		... up to 25 per page
	],
	"pagination": {
		"current_page": 1,
		"per_page": 25,
		"total_page": 11,
		"total_count": 271
	}
}
```

Example of a failed request:

```json
{
    "error": true,
	"error_code": "INVALID_FILTERS",
	"filter_error": "Invalid industry(s) in include list: ['Accountingg']"
}
```

### Final note:

* There are additional search filters available through our API that are not available on the dashboard. [Those are: company.names and company.websites. They allow you to pre-filter on a list of companies. More info below.](/api-docs/search-company#search-from-a-list-of-company-websites-or-names)
* A few filters the dashboard uses internally are rejected by `/search-company` with `INVALID_FILTERS`: `company.company_oids`, `company.company_list_oids`, `company.temp_matching_oids`. To restrict a company search to specific companies, use `company.names` or `company.websites` instead.
* Note that `company.company_oids` **is** supported on [`/search-person`](/api-docs/search-person#filter-on-a-specific-list-of-companies), where it returns people currently employed at the companies you list. The restriction above applies to company search only.

</Steps>

## Paginate the results

You can use the `page` parameter to go paginate the complete result set. The maximum pages is always 1000 when using our API. Use the `pagination` in response to see how many pages exists.

## Response details

| Property | Type | Description |
| :----- | :---- | :---------- |
| `error` | boolean | Indicates if an error has occurred. If `false`, the request was successful. If `true`, an error has occurred and a `error_code` property will be present. See below.  |
| `free` | boolean | Indicates whether this request was free due to deduplication. `true` if your team has already paid for this exact result set within the last 30 days, `false` otherwise. |
| `results` | list | Contains the current page of results. Up to 25 records per page. |
| `pagination` | object | Contains the information about the pagination. Use it to know if you can turn to the next page. |

## Error codes

| HTTP code | `error_code` property          | Meaning                                        |
| :--------- | :--------------- | :--------------------------------------------- |
| **`400`**  | `INVALID_FILTERS` | The filter configuration you used is not supported. See the `filter_error` property for more details. |
| **`400`**  | `PLAN_REQUIRED`   | One or more filters in your request require a higher plan than your current subscription. The `filter_error` property lists each rejected filter and its minimum plan (e.g. `company_key_execs (PRO+)`). See the [Filters Documentation](/api-docs/filters-documentation) for the minimum plan of each filter. |
| **`400`**  | `NO_RESULTS`  | There was no results matching your filters. |
| **`400`**  | `INSUFFICIENT_CREDITS` | You do not have enough credit to perform the request. |
| **`400`**  | `INVALID_API_KEY`     | Invalid API key, check your `X-KEY` header. |
| **`429`**  | `Rate limit exceeded`        | You hit the rate limit for your current plan.  |
| **`400`**  | `INVALID_REQUEST`  | The request your submitted is invalid.  |
| **`400`**  | `SERVICE_TEMPORARILY_UNAVAILABLE`  | A temporary issue occurred on our side, retry the request after a short delay. |
| **`400`**  | `INTERNAL_ERROR`  | An error occurred on our side, please contact the support. |

## Filters

To understand how to use our filters, you have two options:

*	**Filters Documentation** - Refer to our complete [Filters Documentation](/api-docs/filters-documentation) for all available filters, their types, and accepted values.
*	**Dashboard UI** - Use our dashboard UI as [described here](/api-docs/search-company#how-to-perform-a-search) to visually build your search and see the generated payload.

Keep in mind that it is not allowed to perform a search solely with `exclude` filters for performance reasons.

#### Search from a list of company websites or names

There is no option in the UI builder to search using a list of company websites or names. This API still allows you to perform searches using those elements.

<Callout type="info">
	The maximum size is **500** websites or names at once.
</Callout>

```json
{
	"page": 1,
	"filters": {
		"company": {
			"websites": {
				"include": [
					"deloitte.com",
					"https://facebook.com/"
				]
			},
			"names": {
				"include": [
					"Walmart",
					"Microsoft"
				]
			}
		}
    }
}
```

#### ENUM filter values

Many filters are linked to an ENUM, which means that we accept a set list of values.

Below is the list of all the values allowed per filter:

*	company_industry: [Industries](/api-docs/enum/industries)
*	company_headcount_range: [Employee ranges](/api-docs/enum/employee-ranges)
*	company_funding: [Funding stages](/api-docs/enum/funding-stages)
*	company_technology: [Technologies](/api-docs/enum/technologies)
*	company_email_provider: [MX providers](/api-docs/enum/mx-providers)
*	company_naics: [Search Suggestions API](/api-docs/search-suggestions)
*	company_sics: [Search Suggestions API](/api-docs/search-suggestions)

#### Location filter values

As it can be seen on the dashboard, the `company_location_search` filter takes strings as values.

In order to ensure accuracy, the `location` strings you submit must match exactly the one you can pull from the dashboard.

We do not accept arbitrary location string such as "nyc".

<Callout type="info">
	**Programmatic access:** Use our [Search Suggestions API](/api-docs/search-suggestions) to programmatically retrieve valid location values. This endpoint allows you to search for locations and get properly formatted strings that can be used directly in your filters.
</Callout>

Alternatively, build a list of location by inserting them on the filter on the dashboard, look at the generated payload, and re-use those values.

## Rate limit

See our [rate limits page.](/api-docs/rate-limits)