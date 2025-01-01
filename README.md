# ztube

**A Safe and Customizable YouTube Viewing Experience for Kids**

## Description

ztube is a free web application designed to give parents complete control over the YouTube content their children can access. It provides a safe and managed environment where kids can enjoy educational and entertaining videos without the distractions and potential risks of the main YouTube platform. Unlike YouTube Kids, ztube offers granular control, including playlist-based access and support for unlisted videos, addressing the limitations of existing solutions.

## Goals

*   **Child Safety:** Create a secure video-watching environment for children, shielding them from inappropriate content and addictive algorithms.
*   **Parental Control:** Empower parents with easy-to-use tools to manage the videos, playlists, and channels their children can access.
*   **Granular Access Management:**  Allow parents to grant access based on specific videos, playlists (including unlisted ones), or entire YouTube channels.
*   **Time Management:** Implement features that enable parents to set viewing time limits and schedules.
*   **Ease of Use:** Design an intuitive interface for both parents and children.
*   **Free and Accessible:**  Provide a free service accessible to all parents who want a safer YouTube experience for their kids.
*   **Improve Upon Existing Solutions:** Address the shortcomings of YouTube Kids by offering more flexibility and control.

## Features

*   **Safe Video Environment:** Only pre-approved videos, playlists, and channels are accessible to children.
*   **Playlist-Based Access:** Parents can grant access to specific YouTube playlists, including unlisted ones.
*   **Channel-Based Access:** Allow access to entire YouTube channels that parents deem suitable.
*   **Video-Based Access:** Enables adding specific videos individually if required.
*   **Time Controls:** Set daily or weekly time limits and create viewing schedules.
*   **User-Friendly Interface:**  Simple and intuitive design for both parent management and child viewing.
*   **Child Profiles:** Create separate profiles for each child with customized access settings.
*   **No Unwanted Content:**  Eliminates the risk of children encountering inappropriate videos, comments, or ads.

## Technology Stack

*   **Frontend:** [Nust.js] - Consider a kid-friendly design and color scheme.
*   **Backend:** [Bun.js] - Focus on security and data privacy.
*   **Database:** [sqlite, turso] - To store user data, preferences, and approved content lists.
*   **YouTube Data API:** To fetch video metadata and manage playlists (if you plan to integrate directly with YouTube).

## Getting Started

**Prerequisites:**

*   [e.g., Node.js and npm]
*   [e.g., YouTube Data API Key (if integrating with YouTube)]
*   [Database setup]

**Installation:**

1.  Clone the repository: `git clone [your repository URL]`
2.  Navigate to the project directory: `cd ztube`
3.  Install dependencies: `npm install` (or `yarn install` or `pip install -r requirements.txt`)
4.  Set up environment variables: (e.g., API keys, database credentials)
5.  Start the development server: `npm start` (or `yarn start` or `python manage.py runserver`)

## Contributing

We welcome contributions from the community! If you'd like to help improve ztube, please follow these steps:

1.  Fork the repository.
2.  Create a new branch: `git checkout -b feature/your-feature-name`
3.  Make your changes and commit them: `git commit -m "Add: Your feature description"`
4.  Push to your branch: `git push origin feature/your-feature-name`
5.  Open a pull request on the main repository.
